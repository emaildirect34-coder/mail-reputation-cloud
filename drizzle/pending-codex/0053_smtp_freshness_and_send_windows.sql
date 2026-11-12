BEGIN;

ALTER TABLE public.campaigns
 ADD COLUMN send_window_start smallint,
 ADD COLUMN send_window_end smallint,
 ADD CONSTRAINT campaigns_send_window_check CHECK (
   (send_window_start IS NULL AND send_window_end IS NULL)
   OR (send_window_start IS NOT NULL AND send_window_end IS NOT NULL
      AND send_window_start BETWEEN 0 AND 1439 AND send_window_end BETWEEN 0 AND 1439 AND send_window_start<>send_window_end)
 );
ALTER TABLE public.campaign_messages ADD COLUMN send_time_zone text;

CREATE TABLE public.agent_smtp_scans (
 server_id uuid PRIMARY KEY REFERENCES public.managed_servers(id) ON DELETE CASCADE,
 reported_at timestamptz NOT NULL,
 observed_through timestamptz NOT NULL
);
ALTER TABLE public.agent_smtp_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_smtp_scans FROM PUBLIC,anon,authenticated;
CREATE INDEX delivery_events_server_received ON public.delivery_events(server_id,received_at DESC);

CREATE FUNCTION public.record_agent_smtp_scan(_server uuid,_through timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF _through IS NULL OR _through NOT BETWEEN now()-interval '1 hour' AND now() THEN RETURN false; END IF;
 INSERT INTO public.agent_smtp_scans(server_id,reported_at,observed_through)
 VALUES (_server,now(),_through)
 ON CONFLICT(server_id) DO UPDATE SET reported_at=now(),
   observed_through=greatest(agent_smtp_scans.observed_through,EXCLUDED.observed_through);
 RETURN true;
END;
$$;

CREATE FUNCTION public.smtp_scan_current(_server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.agent_smtp_scans
  WHERE server_id=_server AND observed_through>=now()-interval '5 minutes');
$$;

CREATE FUNCTION public.read_campaign_smtp_scans(_campaign uuid)
RETURNS TABLE(server_id uuid,label text,reported_at timestamptz,observed_through timestamptz,last_event_at timestamptz,current_scan boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,s.label,scan.reported_at,scan.observed_through,last_event.received_at,public.smtp_scan_current(s.id)
 FROM public.campaigns c JOIN public.managed_servers s ON s.id=ANY(c.server_ids)
 LEFT JOIN public.agent_smtp_scans scan ON scan.server_id=s.id
 LEFT JOIN LATERAL (SELECT e.received_at FROM public.delivery_events e WHERE e.server_id=s.id
   ORDER BY e.received_at DESC LIMIT 1) last_event ON true
 WHERE c.id=_campaign
$$;

CREATE FUNCTION public.campaign_quiet_next(_campaign public.campaigns,_zone text,_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
 local_time timestamp;
 minute_of_day integer;
 opening timestamp;
 zone text := coalesce(_zone,'UTC');
 start_min integer := _campaign.send_window_start;
 end_min integer := _campaign.send_window_end;
BEGIN
 IF start_min IS NULL THEN RETURN NULL; END IF;
 BEGIN
  local_time := _at AT TIME ZONE zone;
 EXCEPTION WHEN invalid_parameter_value THEN
  zone := 'UTC';
  local_time := _at AT TIME ZONE zone;
 END;
 minute_of_day := extract(hour from local_time)::integer*60+extract(minute from local_time)::integer;
 IF (start_min<end_min AND minute_of_day>=start_min AND minute_of_day<end_min)
  OR (start_min>end_min AND (minute_of_day>=start_min OR minute_of_day<end_min)) THEN RETURN NULL; END IF;
 opening := date_trunc('day',local_time)+make_interval(mins=>start_min);
 IF opening<=local_time THEN opening := opening+interval '1 day'; END IF;
 RETURN opening AT TIME ZONE zone;
END;
$$;

CREATE FUNCTION public.discard_suppressed_campaign_messages(_server uuid,_campaign uuid,_only_message uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
 removed integer;
BEGIN
 UPDATE public.campaign_messages SET status='failed',error='Destinataire supprimé avant injection'
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='queued' AND (_campaign IS NULL OR cm.campaign_id=_campaign)
     AND (_only_message IS NULL OR cm.id=_only_message)
     AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   FOR UPDATE OF cm SKIP LOCKED
 );
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_campaign_waves(_server uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  candidate record;
  decision text;
BEGIN
  IF NOT public.smtp_scan_current(_server) THEN RETURN; END IF;
  FOR candidate IN
    SELECT w.campaign_id,w.provider
    FROM public.campaign_delivery_waves w JOIN public.campaigns c ON c.id=w.campaign_id
    WHERE c.status='queued' AND c.auto_pause_reason IS NULL
      AND _server=ANY(c.server_ids) AND (c.scheduled_at IS NULL OR c.scheduled_at<=now())
      AND w.allowed_wave<3 AND w.next_check_at<=now()
      AND EXISTS (
        SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=w.campaign_id
          AND m.delivery_wave>w.allowed_wave AND m.status='queued'
          AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=w.provider
      )
    ORDER BY w.next_check_at,w.campaign_id,w.provider LIMIT 25 FOR NO KEY UPDATE OF c SKIP LOCKED
  LOOP
    SELECT s.state INTO decision FROM public.read_campaign_wave_status(candidate.campaign_id) s
    WHERE s.provider=candidate.provider;
    UPDATE public.campaign_delivery_waves SET
      allowed_wave=allowed_wave+CASE WHEN decision='ready' THEN 1 ELSE 0 END,
      next_check_at=now()+interval '1 minute'
    WHERE campaign_id=candidate.campaign_id AND provider=candidate.provider;
  END LOOP;
END;
$$;

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_send_window;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_send_window(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 opening timestamptz;
 recipient text;
 use_window boolean;
BEGIN
 SELECT md5(lower(btrim(m.email))),c.send_window_start IS NOT NULL INTO recipient,use_window
 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
 WHERE m.id=_id AND m.server_id=_server AND m.status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT use_window THEN RETURN public.agent_may_inject_before_send_window(_server,_id); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(recipient,29029));
 SELECT public.campaign_quiet_next(c,m.send_time_zone,clock_timestamp()) INTO opening
 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
 WHERE m.id=_id AND m.server_id=_server AND m.status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 IF opening IS NOT NULL THEN
  UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,available_at=greatest(available_at,opening)
  WHERE id=_id AND server_id=_server AND status='claimed' AND permit_granted_at IS NULL;
  RETURN false;
 END IF;
 RETURN public.agent_may_inject_before_send_window(_server,_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.advance_campaign_waves(_server);
 UPDATE public.campaign_messages m SET
   status=CASE WHEN m.delivery_state='pending' THEN 'failed' ELSE 'sent' END,
   sent_at=CASE WHEN m.delivery_state='pending' THEN m.sent_at ELSE coalesce(m.sent_at,m.permit_granted_at,m.claimed_at) END,
   injection_uncertain_at=CASE WHEN m.delivery_state='pending' THEN now() END,
   error=CASE WHEN m.delivery_state='pending' THEN 'Injection KumoMTA à vérifier' END
 WHERE m.id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'
   ORDER BY cm.claimed_at,cm.id LIMIT 500 FOR UPDATE OF cm SKIP LOCKED
 );
 PERFORM public.discard_suppressed_campaign_messages(_server,NULL);
 RETURN QUERY UPDATE public.campaign_messages SET status='claimed',claimed_at=now()
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND public.campaign_can_claim(c,_server)
     AND public.campaign_message_ready(c,cm.email)
     AND public.campaign_wave_ready(c.id,cm.email,cm.delivery_wave)
     AND public.campaign_quiet_next(c,cm.send_time_zone,now()) IS NULL
     AND (cm.available_at IS NULL OR cm.available_at<=now()) AND cm.status='queued'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.smtp_scan_current(uuid),public.campaign_quiet_next(public.campaigns,text,timestamptz),
 public.discard_suppressed_campaign_messages(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_agent_smtp_scan(uuid,timestamptz),public.read_campaign_smtp_scans(uuid),public.agent_may_inject(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_agent_smtp_scan(uuid,timestamptz),public.read_campaign_smtp_scans(uuid),public.agent_may_inject(uuid,uuid)
 TO service_role;
COMMIT;
