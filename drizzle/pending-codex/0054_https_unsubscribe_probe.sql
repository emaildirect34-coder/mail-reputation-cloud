BEGIN;

ALTER TABLE public.campaign_placement_monitors ADD COLUMN unsubscribe_https_verified_at timestamptz;
CREATE TABLE public.campaign_unsubscribe_probes (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
 test_campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
 token_message_id uuid NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE,
 queued_message_id uuid NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
ALTER TABLE public.campaign_unsubscribe_probes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_unsubscribe_probes FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.reset_unsubscribe_proof_on_retest()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.unsubscribe_https_verified_at := NULL;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reset_unsubscribe_proof_on_retest
BEFORE UPDATE OF test_campaign_id ON public.campaign_placement_monitors
FOR EACH ROW WHEN (OLD.test_campaign_id<>NEW.test_campaign_id)
EXECUTE FUNCTION public.reset_unsubscribe_proof_on_retest();

CREATE FUNCTION public.finish_campaign_unsubscribe_probe(_probe uuid,_http_ok boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 probe public.campaign_unsubscribe_probes;
 recipient text;
 server uuid;
 passed boolean := false;
BEGIN
 SELECT * INTO probe FROM public.campaign_unsubscribe_probes WHERE id=_probe FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT email,server_id INTO recipient,server FROM public.campaign_messages WHERE id=probe.token_message_id;
 IF _http_ok AND probe.expires_at>=now() AND EXISTS (
   SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(recipient) AND s.reason='unsubscribe'
     AND s.source='campagne '||probe.test_campaign_id::text
 ) THEN
   passed := public.discard_suppressed_campaign_messages(server,probe.test_campaign_id,probe.queued_message_id)=1
      OR EXISTS (SELECT 1 FROM public.campaign_messages WHERE id=probe.queued_message_id AND status='failed'
        AND error='Destinataire supprimé avant injection');
 END IF;
 IF passed THEN
   UPDATE public.campaign_placement_monitors SET unsubscribe_https_verified_at=now()
   WHERE campaign_id=probe.campaign_id AND test_campaign_id=probe.test_campaign_id;
   passed := FOUND;
 END IF;
 DELETE FROM public.campaign_unsubscribe_probes WHERE id=_probe;
 DELETE FROM public.campaign_messages WHERE id IN (probe.token_message_id,probe.queued_message_id);
 DELETE FROM public.suppressions WHERE email_md5=md5(recipient) AND source='campagne '||probe.test_campaign_id::text;
 UPDATE public.campaigns c SET status='done'
 WHERE c.id=probe.test_campaign_id AND c.status='queued' AND NOT EXISTS (
   SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
    AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
 );
 RETURN passed;
END;
$$;

CREATE FUNCTION public.prepare_campaign_unsubscribe_probe(_campaign uuid)
RETURNS TABLE(id uuid,token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 monitor public.campaign_placement_monitors;
 existing public.campaign_unsubscribe_probes;
 probe_id uuid := gen_random_uuid();
 first_id uuid;
 second_id uuid;
 unsub text;
 recipient text := 'email-direct-unsub-'||probe_id::text||'@example.invalid';
BEGIN
 -- Serialize preparation and cleanup without holding a monitor row while
 -- attempting to lock an older probe.
 PERFORM pg_advisory_xact_lock(hashtextextended(_campaign::text,54054));
 SELECT * INTO existing FROM public.campaign_unsubscribe_probes p WHERE p.campaign_id=_campaign;
 IF FOUND THEN
   IF existing.expires_at>=now() THEN RETURN; END IF;
   PERFORM public.finish_campaign_unsubscribe_probe(existing.id,false);
 END IF;
 SELECT * INTO monitor FROM public.campaign_placement_monitors m WHERE m.campaign_id=_campaign FOR SHARE;
 IF NOT FOUND OR NOT monitor.unsubscribe_verified OR monitor.unsubscribe_https_verified_at IS NOT NULL THEN RETURN; END IF;
 INSERT INTO public.campaign_messages(campaign_id,server_id,email,status,available_at)
 VALUES (monitor.test_campaign_id,monitor.server_id,recipient,'skipped','infinity')
 RETURNING campaign_messages.id,unsub_token INTO first_id,unsub;
 INSERT INTO public.campaign_messages(campaign_id,server_id,email,status,available_at)
 VALUES (monitor.test_campaign_id,monitor.server_id,recipient,'queued','infinity')
 RETURNING campaign_messages.id INTO second_id;
 INSERT INTO public.campaign_unsubscribe_probes(id,campaign_id,test_campaign_id,token_message_id,queued_message_id,expires_at)
 VALUES (probe_id,_campaign,monitor.test_campaign_id,first_id,second_id,now()+interval '2 minutes');
 RETURN QUERY SELECT probe_id,unsub;
END;
$$;

ALTER FUNCTION public.release_campaign_provider(uuid,text) RENAME TO release_campaign_provider_before_https;
REVOKE ALL ON FUNCTION public.release_campaign_provider_before_https(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.release_campaign_provider(_campaign uuid,_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.campaigns WHERE id=_campaign FOR NO KEY UPDATE;
 PERFORM 1 FROM public.campaign_placement_monitors WHERE campaign_id=_campaign
   AND unsubscribe_https_verified_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN public.release_campaign_provider_before_https(_campaign,_provider);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_campaign_unsubscribe_probe(uuid),
 public.finish_campaign_unsubscribe_probe(uuid,boolean),public.release_campaign_provider(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_campaign_unsubscribe_probe(uuid),
 public.finish_campaign_unsubscribe_probe(uuid,boolean),public.release_campaign_provider(uuid,text)
 TO service_role;

ALTER FUNCTION public.read_campaign_wave_status(uuid) RENAME TO read_campaign_wave_status_before_smtp_checks;
REVOKE ALL ON FUNCTION public.read_campaign_wave_status_before_smtp_checks(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_campaign_wave_status(_campaign uuid)
RETURNS TABLE(provider text,wave smallint,planned integer,accepted integer,deferred integer,bounced integer,
 complaints integer,remaining integer,state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT w.provider,w.wave,w.planned,w.accepted,w.deferred,w.bounced,w.complaints,w.remaining,
  CASE WHEN w.state='ready' AND NOT public.smtp_scan_current(c.server_ids[1]) THEN 'telemetry'
       WHEN w.state='ready' AND p.unsubscribe_https_verified_at IS NULL THEN 'unsubscribe'
       ELSE w.state END
 FROM public.read_campaign_wave_status_before_smtp_checks(_campaign) w
 JOIN public.campaigns c ON c.id=_campaign
 LEFT JOIN public.campaign_placement_monitors p ON p.campaign_id=c.id
$$;
REVOKE ALL ON FUNCTION public.read_campaign_wave_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_campaign_wave_status(uuid) TO service_role;

ALTER FUNCTION public.claim_campaign_messages(uuid,integer) RENAME TO claim_campaign_messages_before_probe_cleanup;
REVOKE ALL ON FUNCTION public.claim_campaign_messages_before_probe_cleanup(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 expired uuid;
BEGIN
 FOR expired IN SELECT p.id FROM public.campaign_unsubscribe_probes p
   JOIN public.campaign_messages m ON m.id=p.token_message_id
   WHERE m.server_id=_server AND p.expires_at<now()
   ORDER BY p.expires_at LIMIT 20 FOR UPDATE OF p SKIP LOCKED
 LOOP
   PERFORM public.finish_campaign_unsubscribe_probe(expired,false);
 END LOOP;
 RETURN QUERY SELECT * FROM public.claim_campaign_messages_before_probe_cleanup(_server,_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;
COMMIT;
