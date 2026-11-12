BEGIN;

ALTER TABLE public.sponsor_offers ADD COLUMN delivery_paused boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.provider_smtp_policy(_provider text,_code integer,_detail text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE
  WHEN _provider='Gmail' AND _code BETWEEN 400 AND 499
    AND _detail ~ '(^|[^0-9.])4[.]7[.]28([^0-9.]|$)' THEN 'gmail_rate'
  WHEN _provider='Microsoft' AND _code=550
    AND _detail ~ '(^|[^0-9.])5[.]7[.]515([^0-9.]|$)' THEN 'outlook_auth'
  WHEN _provider='Orange' AND _code BETWEEN 400 AND 599 AND _detail ~* 'OFR[0-9]+_104([^0-9]|$)' THEN 'orange_connections'
 END;
$$;

CREATE TABLE public.delivery_provider_holds (
  provider text NOT NULL,
  sender_domain text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL,
  until_at timestamptz,
  PRIMARY KEY(provider,sender_domain)
);
ALTER TABLE public.delivery_provider_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_provider_holds FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public.delivery_provider_holds TO service_role;

CREATE FUNCTION public.observe_provider_smtp_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  reason text := public.provider_smtp_policy(NEW.isp,NEW.smtp_code,NEW.detail);
  domain text;
  deadline timestamptz;
BEGIN
  IF reason IS NULL OR NEW.occurred_at NOT BETWEEN now()-interval '1 hour' AND now()+interval '1 minute' THEN RETURN NEW; END IF;
  SELECT lower(split_part(from_email,'@',2)) INTO domain FROM public.campaigns WHERE id=NEW.campaign_id;
  deadline := CASE reason WHEN 'gmail_rate' THEN NEW.occurred_at+interval '10 minutes'
                          WHEN 'orange_connections' THEN NEW.occurred_at+interval '5 minutes' END;
  INSERT INTO public.delivery_provider_holds(provider,sender_domain,reason,occurred_at,until_at)
  VALUES (NEW.isp,domain,reason,NEW.occurred_at,deadline)
  ON CONFLICT(provider,sender_domain) DO UPDATE SET reason=EXCLUDED.reason, occurred_at=EXCLUDED.occurred_at, until_at=EXCLUDED.until_at
  WHERE EXCLUDED.occurred_at > delivery_provider_holds.occurred_at;
  RETURN NEW;
END;
$$;
CREATE TRIGGER observe_provider_smtp_policy AFTER INSERT ON public.delivery_events
FOR EACH ROW EXECUTE FUNCTION public.observe_provider_smtp_policy();

CREATE OR REPLACE FUNCTION public.campaign_message_ready(_campaign public.campaigns,_email text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT (NOT _campaign.requires_placement OR EXISTS (
   SELECT 1 FROM public.campaign_placement_releases r WHERE r.campaign_id=_campaign.id
    AND r.provider=public.campaign_recipient_provider(lower(split_part(_email,'@',2)))
 )) AND (_campaign.sponsor_offer_id IS NULL OR EXISTS (
   SELECT 1 FROM public.sponsor_offers o WHERE o.id=_campaign.sponsor_offer_id AND o.status='active' AND NOT o.delivery_paused
 )) AND NOT EXISTS (
   SELECT 1 FROM public.delivery_provider_holds h
   WHERE h.provider=public.campaign_recipient_provider(lower(split_part(_email,'@',2)))
     AND h.sender_domain=lower(split_part(_campaign.from_email,'@',2))
     AND (h.until_at IS NULL OR h.until_at > now())
     AND NOT (_campaign.placement_probe_token IS NOT NULL AND h.reason='outlook_auth')
 )
$$;

CREATE FUNCTION public.clear_verified_outlook_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.provider='Microsoft' THEN
    DELETE FROM public.delivery_provider_holds h
    USING public.campaigns c, public.campaign_placement_monitors m
    WHERE h.provider=NEW.provider AND h.reason='outlook_auth' AND c.id=NEW.campaign_id
      AND m.campaign_id=c.id AND m.observed_at>h.occurred_at
      AND h.sender_domain=lower(split_part(c.from_email,'@',2))
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(m.seeds) s
        WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))='Microsoft'
          AND (s->>'received_at')::timestamptz>h.occurred_at
      );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clear_verified_outlook_hold AFTER INSERT OR UPDATE ON public.campaign_placement_releases
FOR EACH ROW EXECUTE FUNCTION public.clear_verified_outlook_hold();

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
 smtp_policy text;
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
  provider:=public.campaign_recipient_provider(domain);
  smtp_policy:=public.provider_smtp_policy(provider,code,detail);

  INSERT INTO public.delivery_events(server_id,event_key,message_id,campaign_id,campaign_name,recipient,isp,event_type,smtp_code,detail,occurred_at)
  VALUES(_server,e->>'eventKey',m.id,m.campaign_id,campaign.name,m.email,provider,event_type,code,detail,happened_at)
  ON CONFLICT(server_id,event_key) DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NULL THEN CONTINUE; END IF;
  accepted:=accepted+1;
  IF smtp_policy IS NOT NULL THEN
   UPDATE public.campaign_messages SET delivery_state=CASE WHEN code>=500 THEN 'bounced' ELSE 'deferred' END
   WHERE id=m.id AND delivery_state IN ('pending','deferred');
   CONTINUE;
  END IF;

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
     SELECT 1 FROM public.delivery_events de WHERE de.campaign_id=m.campaign_id AND de.message_id=sample.id AND de.event_type='bounce' AND public.provider_smtp_policy(de.isp,de.smtp_code,de.detail) IS NULL
   )) INTO total_n,bad_n
   FROM (
     SELECT id FROM public.campaign_messages
     WHERE campaign_id=m.campaign_id AND (status='sent' OR delivery_state<>'pending')
     ORDER BY sent_at NULLS LAST,created_at,id LIMIT 500
   ) sample;
   IF total_n>0 AND bad_n::numeric/total_n>0.03 THEN
    reason:='Rebonds durs > 3 % sur les premiers 500 messages acceptés';
   ELSE
    SELECT count(*) INTO total_n FROM public.campaign_messages cm
    WHERE cm.campaign_id=m.campaign_id AND (cm.status='sent' OR cm.delivery_state<>'pending');
    SELECT count(DISTINCT de.message_id) INTO bad_n FROM public.delivery_events de
    WHERE de.campaign_id=m.campaign_id AND de.event_type='bounce' AND public.provider_smtp_policy(de.isp,de.smtp_code,de.detail) IS NULL;
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
   WHERE de.campaign_id=m.campaign_id AND de.isp=provider AND de.event_type='deferred' AND de.smtp_code=421 AND public.provider_smtp_policy(de.isp,de.smtp_code,de.detail) IS NULL
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
