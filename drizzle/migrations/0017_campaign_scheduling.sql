BEGIN;
ALTER TABLE public.campaigns ADD COLUMN scheduled_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.campaign_messages cm SET status='failed',error='Destinataire supprimé avant injection' WHERE cm.server_id=_server AND cm.status='queued' AND EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))));
 RETURN QUERY UPDATE public.campaign_messages m SET status='claimed',claimed_at=now() WHERE m.id IN (
 SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id WHERE cm.server_id=_server AND c.status='queued'
 AND (c.scheduled_at IS NULL OR c.scheduled_at <= now())
 AND (cm.status='queued' OR (cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'))
 AND NOT EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
 ORDER BY cm.created_at LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF cm SKIP LOCKED) RETURNING m.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;
COMMIT;
