BEGIN;

ALTER TABLE public.contact_lists
 ADD COLUMN quarantined_at timestamptz,
 ADD COLUMN quarantine_reason text,
 ADD CONSTRAINT contact_lists_quarantine_pair CHECK ((quarantined_at IS NULL) = (quarantine_reason IS NULL));

ALTER TABLE public.delivery_alerts DROP CONSTRAINT delivery_alerts_rule_check;
ALTER TABLE public.delivery_alerts
 ADD CONSTRAINT delivery_alerts_rule_check CHECK (rule IN ('hard_bounce','complaint','throttle'));

CREATE INDEX delivery_events_campaign_isp_recent
 ON public.delivery_events(campaign_id,isp,occurred_at DESC,received_at DESC,id DESC);
CREATE INDEX delivery_events_campaign_bounce
 ON public.delivery_events(campaign_id,message_id) WHERE event_type='bounce';
CREATE INDEX delivery_events_421_recent
 ON public.delivery_events(campaign_id,isp,occurred_at DESC,message_id)
 WHERE event_type='deferred' AND smtp_code=421;

CREATE FUNCTION public.campaign_can_claim(_campaign public.campaigns, _server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _campaign.status='queued' AND _campaign.auto_pause_reason IS NULL
   AND (_campaign.scheduled_at IS NULL OR _campaign.scheduled_at <= now())
   AND NOT EXISTS (
     SELECT 1 FROM public.contact_lists
     WHERE id=_campaign.list_id AND quarantined_at IS NOT NULL
   );
$$;
REVOKE ALL ON FUNCTION public.campaign_can_claim(public.campaigns,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_can_claim(public.campaigns,uuid) TO service_role;

CREATE FUNCTION public.check_campaign_quarantine()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='queued' THEN
  IF NEW.auto_pause_reason IS NOT NULL THEN
   RAISE EXCEPTION 'Campagne bloquée par la protection automatique';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contact_lists WHERE id=NEW.list_id AND quarantined_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Liste de contacts en quarantaine';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER campaigns_check_quarantine
 BEFORE INSERT OR UPDATE OF status,list_id,auto_pause_reason ON public.campaigns
 FOR EACH ROW EXECUTE FUNCTION public.check_campaign_quarantine();

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.campaign_messages SET status='failed',error='Destinataire supprimé avant injection'
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='queued'
     AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   FOR UPDATE OF cm SKIP LOCKED
 );
 RETURN QUERY UPDATE public.campaign_messages SET status='claimed',claimed_at=now()
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm
   JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND public.campaign_can_claim(c,_server)
     AND (cm.available_at IS NULL OR cm.available_at <= now())
     AND (cm.status='queued' OR (cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'))
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id
   LIMIT GREATEST(0,LEAST(_limit,500))
   FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_delivery_events(_server uuid, _events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
 e jsonb;
 m public.campaign_messages;
 campaign public.campaigns;
 new_id uuid;
 accepted integer:=0;
 event_type text;
 code integer;
 detail text;
 happened_at timestamptz;
 domain text;
 provider text;
 total_n integer;
 bad_n integer;
 consecutive boolean;
 reason text;
 alert_rule text;
 alert_isp text;
 alert_rate numeric;
 isolate_list boolean;
BEGIN
 IF jsonb_typeof(_events) IS DISTINCT FROM 'array' OR jsonb_array_length(_events)>500 THEN
  RAISE EXCEPTION 'Invalid batch';
 END IF;

 -- Lock shared audience and campaign rows in consistent order across agents.
 PERFORM l.id FROM public.contact_lists l
 WHERE EXISTS (
   SELECT 1 FROM jsonb_array_elements(_events) e(value)
   JOIN public.campaign_messages cm ON cm.id=(e.value->>'messageId')::uuid AND cm.server_id=_server
   JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE c.list_id=l.id AND e.value->>'type' IN ('bounce','complaint')
 ) ORDER BY l.id FOR NO KEY UPDATE OF l;
 PERFORM c.id FROM public.campaigns c
 WHERE EXISTS (
   SELECT 1 FROM jsonb_array_elements(_events) e(value)
   JOIN public.campaign_messages cm ON cm.id=(e.value->>'messageId')::uuid AND cm.server_id=_server
   WHERE cm.campaign_id=c.id
 ) ORDER BY c.id FOR NO KEY UPDATE OF c;

 FOR e IN SELECT value FROM jsonb_array_elements(_events) ORDER BY (value->>'occurredAt')::timestamptz,value->>'eventKey' LOOP
  SELECT * INTO m FROM public.campaign_messages WHERE id=(e->>'messageId')::uuid AND server_id=_server;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not assigned to this agent'; END IF;
  SELECT * INTO STRICT campaign FROM public.campaigns WHERE id=m.campaign_id;
  event_type:=e->>'type';
  code:=NULLIF(e->>'smtpCode','')::integer;
  detail:=left(COALESCE(e->>'detail',''),1000);
  happened_at:=(e->>'occurredAt')::timestamptz;
  domain:=lower(split_part(m.email,'@',2));
  provider:=CASE
    WHEN domain IN ('gmail.com','googlemail.com') THEN 'Gmail'
    WHEN domain IN ('outlook.com','hotmail.com','hotmail.fr','outlook.fr','live.com','msn.com') THEN 'Microsoft'
    WHEN domain IN ('yahoo.com','yahoo.fr','aol.com') THEN 'Yahoo'
    WHEN domain IN ('orange.fr','wanadoo.fr') THEN 'Orange'
    WHEN domain IN ('sfr.fr','neuf.fr') THEN 'SFR'
    ELSE domain END;

  INSERT INTO public.delivery_events(server_id,event_key,message_id,campaign_id,campaign_name,recipient,isp,event_type,smtp_code,detail,occurred_at)
  VALUES(_server,e->>'eventKey',m.id,m.campaign_id,campaign.name,m.email,provider,event_type,code,detail,happened_at)
  ON CONFLICT(server_id,event_key) DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NULL THEN CONTINUE; END IF;
  accepted:=accepted+1;

  UPDATE public.campaign_messages SET delivery_state=CASE
    WHEN event_type='complaint' THEN 'complained'
    WHEN delivery_state='complained' THEN delivery_state
    WHEN event_type='bounce' THEN 'bounced'
    WHEN delivery_state='bounced' THEN delivery_state
    WHEN event_type='delivered' THEN 'delivered'
    WHEN delivery_state='delivered' THEN delivery_state ELSE 'deferred' END WHERE id=m.id;

  IF event_type IN ('bounce','complaint') THEN
   INSERT INTO public.suppressions(email_md5,reason,source)
   VALUES(md5(lower(btrim(m.email))),event_type,'KumoMTA')
   ON CONFLICT(email_md5) DO UPDATE SET reason=CASE WHEN EXCLUDED.reason='complaint' THEN 'complaint' ELSE suppressions.reason END;
   UPDATE public.contacts SET status=CASE WHEN event_type='complaint' THEN 'complained' WHEN status='complained' THEN status ELSE 'bounced' END
   WHERE email_md5=md5(lower(btrim(m.email)));
  END IF;

  reason:=NULL;
  isolate_list:=false;
  alert_isp:=provider;
  IF event_type='bounce' THEN
   alert_rule:='hard_bounce';
   alert_isp:='Tous';
   SELECT count(*),count(*) FILTER(WHERE EXISTS(
     SELECT 1 FROM public.delivery_events de WHERE de.campaign_id=m.campaign_id AND de.message_id=sample.id AND de.event_type='bounce'
   )) INTO total_n,bad_n
   FROM (
     SELECT id FROM public.campaign_messages
     WHERE campaign_id=m.campaign_id AND (status='sent' OR delivery_state<>'pending')
     ORDER BY sent_at NULLS LAST,created_at,id LIMIT 500
   ) sample;
   IF total_n>0 AND bad_n::numeric/total_n>0.03 THEN
    reason:='Rebonds durs > 3 % sur les premiers 500 messages acceptés';
   ELSE
    -- Keep monitoring after the initial sample. Each affected message counts once.
    SELECT count(*) INTO total_n FROM public.campaign_messages cm
    WHERE cm.campaign_id=m.campaign_id AND (cm.status='sent' OR cm.delivery_state<>'pending');
    SELECT count(DISTINCT de.message_id) INTO bad_n FROM public.delivery_events de
    WHERE de.campaign_id=m.campaign_id AND de.event_type='bounce';
    IF total_n>=20 AND bad_n::numeric/total_n>=0.05 THEN
     reason:='Rebonds durs ≥ 5 % sur la campagne';
    END IF;
   END IF;
   isolate_list:=bad_n>=3;
  ELSIF event_type='complaint' THEN
   alert_rule:='complaint';
   SELECT count(DISTINCT de.message_id) INTO bad_n FROM public.delivery_events de
   WHERE de.campaign_id=m.campaign_id AND de.isp=provider AND de.event_type='complaint';
   SELECT count(*) INTO total_n
   FROM public.campaign_messages cm
   WHERE cm.campaign_id=m.campaign_id AND (cm.status='sent' OR cm.delivery_state<>'pending') AND
    CASE WHEN lower(split_part(cm.email,'@',2)) IN ('gmail.com','googlemail.com') THEN 'Gmail'
    WHEN lower(split_part(cm.email,'@',2)) IN ('outlook.com','hotmail.com','hotmail.fr','outlook.fr','live.com','msn.com') THEN 'Microsoft'
    WHEN lower(split_part(cm.email,'@',2)) IN ('yahoo.com','yahoo.fr','aol.com') THEN 'Yahoo'
    WHEN lower(split_part(cm.email,'@',2)) IN ('orange.fr','wanadoo.fr') THEN 'Orange'
    WHEN lower(split_part(cm.email,'@',2)) IN ('sfr.fr','neuf.fr') THEN 'SFR'
    ELSE lower(split_part(cm.email,'@',2)) END=provider;

   IF total_n>0 AND bad_n::numeric/total_n>0.0008 THEN
    reason:='Plaintes > 0,08 % chez '||provider;
   ELSE
    SELECT count(DISTINCT recent.message_id)=3 AND bool_and(recent.event_type='complaint') INTO consecutive
    FROM (
      SELECT de.message_id,de.event_type FROM public.delivery_events de
      WHERE de.campaign_id=m.campaign_id AND de.isp=provider
      ORDER BY de.occurred_at DESC,de.received_at DESC,de.id DESC LIMIT 3
    ) recent;
    IF consecutive THEN reason:='3 plaintes successives chez '||provider; END IF;
   END IF;
   isolate_list:=bad_n>=3 OR (total_n>=100 AND bad_n::numeric/total_n>0.003);
  ELSIF event_type='deferred' AND code=421 AND happened_at BETWEEN now()-interval '5 minutes' AND now()+interval '1 minute' THEN
   alert_rule:='throttle';
   SELECT count(DISTINCT de.message_id) INTO bad_n FROM public.delivery_events de
   WHERE de.campaign_id=m.campaign_id AND de.isp=provider AND de.event_type='deferred' AND de.smtp_code=421
     AND de.occurred_at BETWEEN now()-interval '5 minutes' AND now()+interval '1 minute';
   total_n:=bad_n;
   IF detail ~ '(^|[^0-9])4[.]7[.][0-9]+([^0-9]|$)' OR bad_n>=3 THEN
    reason:='Limitation SMTP 421 chez '||provider;
   END IF;
  END IF;

  IF reason IS NOT NULL THEN
   alert_rate:=CASE WHEN total_n>0 THEN bad_n::numeric/total_n ELSE 0 END;
   INSERT INTO public.delivery_alerts(campaign_id,campaign_name,rule,isp,rate,sample_size)
   VALUES(m.campaign_id,campaign.name,alert_rule,alert_isp,alert_rate,total_n)
   ON CONFLICT(campaign_id,rule,isp) DO UPDATE SET rate=EXCLUDED.rate,sample_size=EXCLUDED.sample_size;
   UPDATE public.campaigns SET
    status=CASE WHEN status='queued' THEN 'paused' ELSE status END,
    auto_pause_reason=COALESCE(auto_pause_reason,reason)
   WHERE id=m.campaign_id AND status<>'cancelled';
   IF isolate_list AND campaign.list_id IS NOT NULL THEN
    UPDATE public.contact_lists SET quarantined_at=now(),quarantine_reason=reason
    WHERE id=campaign.list_id AND quarantined_at IS NULL;
   END IF;
  END IF;
 END LOOP;
 RETURN accepted;
END;
$$;
COMMIT;
