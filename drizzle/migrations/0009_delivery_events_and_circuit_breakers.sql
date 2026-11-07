ALTER TABLE public.campaign_messages ADD COLUMN delivery_state text NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','delivered','deferred','bounced','complained'));
ALTER TABLE public.campaigns ADD COLUMN auto_pause_reason text;
CREATE TABLE public.delivery_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id uuid NOT NULL REFERENCES public.managed_servers(id), event_key text NOT NULL,
 message_id uuid NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE, campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
 campaign_name text NOT NULL, recipient text NOT NULL, isp text NOT NULL, event_type text NOT NULL CHECK(event_type IN ('delivered','bounce','deferred','complaint')),
 smtp_code integer, detail text NOT NULL DEFAULT '', occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(server_id,event_key)
);
GRANT SELECT ON public.delivery_events TO authenticated;
GRANT ALL ON public.delivery_events TO service_role;
ALTER TABLE public.delivery_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_events_read ON public.delivery_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin') OR EXISTS(SELECT 1 FROM public.worker_tasks t WHERE t.user_id=auth.uid() AND t.status='active' AND '/dashboard/logs'=ANY(t.allowed_paths)));
CREATE INDEX delivery_events_time ON public.delivery_events(occurred_at DESC);
CREATE INDEX delivery_events_campaign ON public.delivery_events(campaign_id,isp,event_type,message_id);
CREATE TABLE public.delivery_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE, campaign_name text NOT NULL,
 rule text NOT NULL CHECK(rule IN ('hard_bounce','complaint')), isp text NOT NULL, rate numeric NOT NULL, sample_size integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,rule,isp)
);
GRANT SELECT ON public.delivery_alerts TO authenticated;
GRANT ALL ON public.delivery_alerts TO service_role;
ALTER TABLE public.delivery_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_alerts_read ON public.delivery_alerts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin') OR EXISTS(SELECT 1 FROM public.worker_tasks t WHERE t.user_id=auth.uid() AND t.status='active' AND '/dashboard/logs'=ANY(t.allowed_paths)));
CREATE OR REPLACE FUNCTION public.ingest_delivery_events(_server uuid, _events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE e jsonb; m public.campaign_messages; cname text; new_id uuid; n integer:=0; domain text; provider text; total_n integer; bad_n integer; complaint_n integer; reason text;
BEGIN
 IF jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events)>500 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(_events) ORDER BY value->>'messageId', value->>'eventKey' LOOP
  SELECT * INTO m FROM public.campaign_messages WHERE id=(e->>'messageId')::uuid AND server_id=_server;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not assigned to this agent'; END IF;
  SELECT name INTO cname FROM public.campaigns WHERE id=m.campaign_id FOR UPDATE;
  domain:=lower(split_part(m.email,'@',2));
  provider:=CASE WHEN domain IN ('gmail.com','googlemail.com') THEN 'Gmail' WHEN domain IN ('outlook.com','hotmail.com','hotmail.fr','outlook.fr','live.com','msn.com') THEN 'Microsoft' WHEN domain IN ('yahoo.com','yahoo.fr','aol.com') THEN 'Yahoo' ELSE domain END;
  INSERT INTO public.delivery_events(server_id,event_key,message_id,campaign_id,campaign_name,recipient,isp,event_type,smtp_code,detail,occurred_at)
  VALUES(_server,e->>'eventKey',m.id,m.campaign_id,cname,m.email,provider,e->>'type',NULLIF(e->>'smtpCode','')::integer,left(COALESCE(e->>'detail',''),1000),(e->>'occurredAt')::timestamptz)
  ON CONFLICT(server_id,event_key) DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NULL THEN CONTINUE; END IF;
  n:=n+1;
  UPDATE public.campaign_messages SET delivery_state=CASE
   WHEN e->>'type'='complaint' THEN 'complained'
   WHEN delivery_state='complained' THEN delivery_state
   WHEN e->>'type'='bounce' THEN 'bounced'
   WHEN delivery_state='bounced' THEN delivery_state
   WHEN e->>'type'='delivered' THEN 'delivered'
   WHEN delivery_state='delivered' THEN delivery_state ELSE 'deferred' END WHERE id=m.id;
  IF e->>'type' IN ('bounce','complaint') THEN
   INSERT INTO public.suppressions(email_md5,reason,source) VALUES(md5(lower(btrim(m.email))),CASE WHEN e->>'type'='bounce' THEN 'bounce' ELSE 'complaint' END,'KumoMTA')
   ON CONFLICT(email_md5) DO UPDATE SET reason=CASE WHEN EXCLUDED.reason='complaint' THEN 'complaint' ELSE suppressions.reason END;
   UPDATE public.contacts SET status=CASE WHEN e->>'type'='complaint' THEN 'complained' WHEN status='complained' THEN status ELSE 'bounced' END WHERE email_md5=md5(lower(btrim(m.email)));
  END IF;
  -- The first 500 accepted messages, ordered by actual injection time.
  SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.delivery_events de WHERE de.message_id=s.id AND de.event_type='bounce')) INTO total_n,bad_n
  FROM (SELECT id FROM public.campaign_messages WHERE campaign_id=m.campaign_id AND (status='sent' OR delivery_state<>'pending') ORDER BY sent_at NULLS LAST,created_at,id LIMIT 500) s;
  reason:=NULL;
  IF total_n>0 AND bad_n::numeric/total_n>0.03 THEN
   reason:='Rebonds durs > 3 % sur les premiers 500 messages acceptés';
   INSERT INTO public.delivery_alerts(campaign_id,campaign_name,rule,isp,rate,sample_size) VALUES(m.campaign_id,cname,'hard_bounce','Tous',bad_n::numeric/total_n,total_n)
   ON CONFLICT(campaign_id,rule,isp) DO UPDATE SET rate=EXCLUDED.rate,sample_size=EXCLUDED.sample_size;
  END IF;
  SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.delivery_events de WHERE de.message_id=cm.id AND de.event_type='complaint')) INTO total_n,complaint_n
  FROM public.campaign_messages cm WHERE campaign_id=m.campaign_id AND (status='sent' OR delivery_state<>'pending') AND
   CASE WHEN lower(split_part(cm.email,'@',2)) IN ('gmail.com','googlemail.com') THEN 'Gmail' WHEN lower(split_part(cm.email,'@',2)) IN ('outlook.com','hotmail.com','hotmail.fr','outlook.fr','live.com','msn.com') THEN 'Microsoft' WHEN lower(split_part(cm.email,'@',2)) IN ('yahoo.com','yahoo.fr','aol.com') THEN 'Yahoo' ELSE lower(split_part(cm.email,'@',2)) END=provider;
  IF total_n>0 AND complaint_n::numeric/total_n>0.0008 THEN
   reason:='Plaintes > 0,08 % chez '||provider;
   INSERT INTO public.delivery_alerts(campaign_id,campaign_name,rule,isp,rate,sample_size) VALUES(m.campaign_id,cname,'complaint',provider,complaint_n::numeric/total_n,total_n)
   ON CONFLICT(campaign_id,rule,isp) DO UPDATE SET rate=EXCLUDED.rate,sample_size=EXCLUDED.sample_size;
  END IF;
  IF reason IS NOT NULL THEN UPDATE public.campaigns SET status=CASE WHEN status='queued' THEN 'paused' ELSE status END,auto_pause_reason=reason WHERE id=m.campaign_id AND status<>'cancelled'; END IF;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.ingest_delivery_events(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_delivery_events(uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.delivery_log_summary()
RETURNS TABLE(events bigint, delivered bigint, bounced bigint, deferred bigint, complaints bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT count(*),count(DISTINCT message_id) FILTER(WHERE event_type='delivered'),count(DISTINCT message_id) FILTER(WHERE event_type='bounce'),count(*) FILTER(WHERE event_type='deferred'),count(DISTINCT message_id) FILTER(WHERE event_type='complaint') FROM public.delivery_events WHERE occurred_at>=now()-interval '24 hours'; $$;
REVOKE ALL ON FUNCTION public.delivery_log_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delivery_log_summary() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.campaign_messages cm SET status='failed',error='Destinataire supprimé avant injection' WHERE cm.server_id=_server AND cm.status='queued' AND EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))));
 RETURN QUERY UPDATE public.campaign_messages m SET status='claimed',claimed_at=now() WHERE m.id IN (
 SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id WHERE cm.server_id=_server AND c.status='queued'
 AND (cm.status='queued' OR (cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'))
 AND NOT EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
 ORDER BY cm.created_at LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF cm SKIP LOCKED) RETURNING m.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;