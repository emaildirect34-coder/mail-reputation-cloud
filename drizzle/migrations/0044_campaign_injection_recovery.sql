BEGIN;

ALTER TABLE public.campaign_messages ADD COLUMN injection_uncertain_at timestamptz;
CREATE INDEX campaign_messages_uncertain_injection ON public.campaign_messages(injection_uncertain_at DESC)
  WHERE injection_uncertain_at IS NOT NULL;
CREATE INDEX campaign_messages_claim_expiry ON public.campaign_messages(server_id,claimed_at,id)
  WHERE status='claimed';

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- An expired lease cannot prove that KumoMTA never accepted the message.
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
     AND cm.status='queued'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id
   LIMIT GREATEST(0,LEAST(_limit,500))
   FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

CREATE FUNCTION public.reconcile_campaign_injections(_server uuid, _receipts jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  repaired integer;
  repaired_campaign_ids uuid[];
BEGIN
  WITH updated AS (
    UPDATE public.campaign_messages cm SET
      status='sent', sent_at=coalesce(cm.sent_at, receipt."occurredAt"), injection_uncertain_at=NULL, error=NULL
    FROM jsonb_to_recordset(_receipts) AS receipt("messageId" uuid, recipient text, "occurredAt" timestamptz)
    WHERE cm.server_id=_server AND cm.id=receipt."messageId"
      AND lower(btrim(cm.email))=lower(btrim(receipt.recipient))
      AND receipt."occurredAt" >= cm.created_at - interval '1 second'
      AND receipt."occurredAt" <= now() + interval '5 minutes'
      AND (cm.status='claimed' OR cm.injection_uncertain_at IS NOT NULL
        OR (cm.status='failed' AND cm.error='Injection KumoMTA non confirmée'))
    RETURNING cm.campaign_id
  )
  SELECT count(*), array_agg(DISTINCT campaign_id) INTO repaired,repaired_campaign_ids FROM updated;
  UPDATE public.campaigns SET status='done'
  WHERE id IN (
    SELECT c.id FROM public.campaigns c WHERE c.id=ANY(repaired_campaign_ids) AND c.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
        AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
      )
    FOR UPDATE OF c SKIP LOCKED
  );
  RETURN repaired;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_campaign_injections(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_campaign_injections(uuid,jsonb) TO service_role;
COMMIT;
