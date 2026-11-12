BEGIN;

CREATE FUNCTION public.read_campaign_delivery_reconciliation(_campaign uuid)
RETURNS TABLE(planned integer,tracked bigint,excluded_before integer,retries bigint,observed_at timestamptz,outcomes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH RECURSIVE target AS (
  SELECT c.id,c.total,c.suppressed,c.status,c.auto_pause_reason,c.send_expires_at
  FROM public.campaigns c WHERE c.id=_campaign
 ), retry_path(root,id,depth) AS (
  SELECT p.id,m.id,1
  FROM public.campaign_messages m JOIN target c ON c.id=m.campaign_id
  JOIN public.campaign_messages p ON p.id=m.retry_of AND p.campaign_id=c.id AND p.retry_of IS NULL
  UNION ALL
  SELECT path.root,m.id,path.depth+1
  FROM retry_path path JOIN public.campaign_messages m ON m.retry_of=path.id AND m.campaign_id=_campaign
 ), classified AS (
  SELECT m.id,coalesce(path.root,m.id) AS root,coalesce(path.depth,0) AS depth,
   CASE
    WHEN m.delivery_state='delivered' OR (m.delivery_state IN ('bounced','complained') AND EXISTS (
     SELECT 1 FROM public.delivery_events e WHERE e.message_id=m.id AND e.campaign_id=c.id AND e.event_type='delivered'
    )) THEN 'accepted'
    WHEN m.delivery_state='bounced' THEN 'smtp_bounced'
    WHEN m.delivery_state='complained' THEN 'complaint_unconfirmed'
    WHEN m.delivery_state='deferred' THEN 'smtp_deferred'
    WHEN m.status='sent' OR m.sent_at IS NOT NULL THEN 'smtp_pending'
    WHEN m.injection_uncertain_at IS NOT NULL OR m.error IN (
     'Injection KumoMTA non confirmée','Injection KumoMTA à vérifier','Envoi hebdomadaire déjà autorisé, résultat non confirmé'
    ) THEN 'injection_uncertain'
    WHEN m.status='claimed' AND m.permit_granted_at IS NOT NULL THEN 'injection_pending'
    WHEN m.status='expired' OR (
     c.send_expires_at<=statement_timestamp() AND c.status IN ('queued','paused')
     AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
     AND m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL
    ) THEN 'expired'
    WHEN m.status IN ('queued','claimed') THEN CASE WHEN c.status='cancelled' THEN 'cancelled' ELSE 'queued' END
    WHEN m.error='Destinataire supprimé avant injection' THEN 'suppressed'
    WHEN m.error IN (
     'Envois en pause a la demande du destinataire','Format non choisi dans les preferences',
     'Thème non choisi dans les préférences','Cadence de protection du destinataire',
     'Marque exclue dans les préférences du destinataire'
    ) THEN 'preferences'
    WHEN m.error IN ('Relance arrêtée après achat de cette offre','Achat annulé avant injection') THEN 'sponsor'
    WHEN m.error='Boîte pleine, suspension temporaire des campagnes' THEN 'mailbox_hold'
    WHEN m.error IN ('Injection KumoMTA refusée','injection refusée') THEN 'injection_refused'
    WHEN m.status='skipped' THEN 'excluded'
    ELSE 'other'
   END AS bucket
  FROM target c JOIN public.campaign_messages m ON m.campaign_id=c.id
  LEFT JOIN retry_path path ON path.id=m.id
 ), original_outcomes AS (
  -- An observed receipt or SMTP result on an earlier attempt still applies to the original message.
  SELECT DISTINCT ON (root) root,bucket
  FROM classified
  ORDER BY root,CASE bucket
   WHEN 'accepted' THEN 7 WHEN 'smtp_bounced' THEN 6 WHEN 'complaint_unconfirmed' THEN 6
   WHEN 'smtp_deferred' THEN 5 WHEN 'smtp_pending' THEN 4
   WHEN 'injection_uncertain' THEN 3 WHEN 'injection_pending' THEN 2 ELSE 0 END DESC,depth DESC,id
 ), counts AS (
  SELECT bucket,count(*) AS volume FROM original_outcomes GROUP BY bucket
 )
 SELECT c.total,coalesce((SELECT sum(volume)::bigint FROM counts),0),c.suppressed,
  (SELECT count(*) FROM retry_path),statement_timestamp(),
  coalesce((SELECT jsonb_object_agg(bucket,volume) FROM counts),'{}'::jsonb)
 FROM target c
$$;

REVOKE ALL ON FUNCTION public.read_campaign_delivery_reconciliation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_campaign_delivery_reconciliation(uuid) TO service_role;
COMMIT;
