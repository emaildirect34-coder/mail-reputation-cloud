BEGIN;
ALTER TABLE public.campaigns ADD COLUMN send_priority smallint NOT NULL DEFAULT 0 CHECK (send_priority BETWEEN -1 AND 1);

CREATE TABLE public.server_campaign_capacity (
 server_id uuid PRIMARY KEY REFERENCES public.managed_servers(id) ON DELETE CASCADE,
 per_minute integer NOT NULL CHECK (per_minute BETWEEN 1 AND 100000)
);
CREATE TABLE public.campaign_claim_reservations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 server_id uuid NOT NULL REFERENCES public.managed_servers(id) ON DELETE CASCADE,
 reserved_at timestamptz NOT NULL,
 messages integer NOT NULL CHECK (messages BETWEEN 1 AND 500)
);
CREATE INDEX campaign_claim_reservations_window ON public.campaign_claim_reservations(server_id,reserved_at);
ALTER TABLE public.server_campaign_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_claim_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.server_campaign_capacity,public.campaign_claim_reservations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.set_server_campaign_capacity(_server uuid,_per_minute integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF _per_minute IS NOT NULL AND _per_minute NOT BETWEEN 1 AND 100000 THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
 IF NOT EXISTS (SELECT 1 FROM public.managed_servers WHERE id=_server AND status<>'absent') THEN RETURN false; END IF;
 IF _per_minute IS NULL THEN
   DELETE FROM public.server_campaign_capacity WHERE server_id=_server;
 ELSE
   INSERT INTO public.server_campaign_capacity(server_id,per_minute) VALUES (_server,_per_minute)
    ON CONFLICT (server_id) DO UPDATE SET per_minute=EXCLUDED.per_minute;
 END IF;
 RETURN true;
END;
$$;

CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _message.status='queued' AND (_message.available_at IS NULL OR _message.available_at<=now())
   AND public.campaign_can_claim(_campaign,_message.server_id)
   AND public.campaign_message_ready(_campaign,_message.email)
   AND public.campaign_wave_ready(_campaign.id,_message.email,_message.delivery_wave)
   AND public.campaign_quiet_next(_campaign,_message.send_time_zone,now()) IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(_message.email))))
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages_before_probe_cleanup(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 budget integer;
 claimed integer;
 remaining integer := greatest(0,least(_limit,500));
 reserved timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
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
 reserved := clock_timestamp();
 SELECT per_minute INTO budget FROM public.server_campaign_capacity WHERE server_id=_server;
 IF budget IS NOT NULL THEN
   SELECT greatest(0,least(remaining,budget-coalesce(sum(r.messages),0)))::integer INTO remaining
    FROM public.campaign_claim_reservations r WHERE r.server_id=_server AND r.reserved_at>reserved-interval '1 minute';
 END IF;
 DELETE FROM public.campaign_claim_reservations r WHERE r.server_id=_server AND r.reserved_at<=reserved-interval '2 minutes';

 RETURN QUERY UPDATE public.campaign_messages SET status='claimed',claimed_at=reserved
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND cm.status='queued' AND public.campaign_job_ready(c,cm)
   ORDER BY c.send_priority DESC,cm.created_at,cm.id LIMIT remaining FOR UPDATE OF c,cm SKIP LOCKED
 ) RETURNING *;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 IF claimed>0 THEN
   INSERT INTO public.campaign_claim_reservations(server_id,reserved_at,messages) VALUES (_server,reserved,claimed);
 END IF;
END;
$$;

CREATE FUNCTION public.read_campaign_queue_priority(_campaign uuid)
RETURNS TABLE(server_id uuid,label text,priority smallint,per_minute integer,reserved bigint,waiting_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,s.label,c.send_priority,b.per_minute,u.used,
 CASE WHEN b.per_minute IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.server_id=s.id
    AND m.status='queued' AND public.campaign_job_ready(c,m)
 ) THEN CASE WHEN u.used>=b.per_minute THEN 'capacity'
   WHEN EXISTS (
     SELECT 1 FROM public.campaign_messages m JOIN public.campaigns higher ON higher.id=m.campaign_id
     WHERE m.server_id=s.id AND m.status='queued' AND higher.send_priority>c.send_priority
      AND public.campaign_job_ready(higher,m)
   ) THEN 'priority'
 END END
 FROM public.campaigns c JOIN public.managed_servers s ON s.id=ANY(c.server_ids)
 LEFT JOIN public.server_campaign_capacity b ON b.server_id=s.id
 CROSS JOIN LATERAL (
   SELECT coalesce(sum(r.messages),0) AS used FROM public.campaign_claim_reservations r
   WHERE r.server_id=s.id AND r.reserved_at>now()-interval '1 minute'
 ) u
 WHERE c.id=_campaign ORDER BY s.label
$$;

REVOKE ALL ON FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_server_campaign_capacity(uuid,integer),public.read_campaign_queue_priority(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_server_campaign_capacity(uuid,integer),public.read_campaign_queue_priority(uuid)
 TO service_role;
COMMIT;
