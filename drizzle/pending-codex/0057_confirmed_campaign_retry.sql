BEGIN;
-- Some older installs lack the nullable assignment used by the A/B editor.
ALTER TABLE public.campaign_messages ADD COLUMN IF NOT EXISTS variant smallint;
ALTER TABLE public.campaign_messages ADD COLUMN retry_of uuid UNIQUE REFERENCES public.campaign_messages(id) ON DELETE SET NULL;
CREATE INDEX campaign_messages_confirmed_refusals ON public.campaign_messages(campaign_id,id)
 WHERE status='failed' AND error='Injection KumoMTA refusée' AND injection_uncertain_at IS NULL AND sent_at IS NULL AND delivery_state='pending';

CREATE FUNCTION public.campaign_retry_conflict(_message uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 WITH RECURSIVE ancestors AS (
  SELECT m.id,m.retry_of,m.status,m.sent_at,m.delivery_state,m.injection_uncertain_at
  FROM public.campaign_messages m WHERE m.id=(SELECT retry_of FROM public.campaign_messages WHERE id=_message)
  UNION ALL
  SELECT m.id,m.retry_of,m.status,m.sent_at,m.delivery_state,m.injection_uncertain_at
  FROM ancestors a JOIN public.campaign_messages m ON m.id=a.retry_of
 )
 SELECT EXISTS (SELECT 1 FROM ancestors a WHERE a.status='sent' OR a.sent_at IS NOT NULL
   OR a.delivery_state<>'pending' OR a.injection_uncertain_at IS NOT NULL)
$$;

CREATE FUNCTION public.campaign_retry_recipient_ok(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=r.md5)
  AND NOT EXISTS (SELECT 1 FROM public.recipient_mailbox_holds h WHERE h.email_md5=r.md5 AND h.until_at>now())
  AND CASE WHEN _campaign.purchase_thank_you THEN EXISTS (
    SELECT 1 FROM public.sponsor_purchases p WHERE p.thank_you_message_id=_message.id AND p.status='approved'
  ) ELSE
    NOT EXISTS (SELECT 1 FROM public.contact_lists l WHERE l.id=_campaign.list_id AND l.quarantined_at IS NOT NULL)
    AND (_campaign.list_id IS NULL OR EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.id=_message.contact_id AND c.list_id=_campaign.list_id AND c.status='active'
    ))
    AND NOT EXISTS (SELECT 1 FROM public.recipient_snoozes s WHERE s.email_md5=r.md5 AND s.until_at>now())
    AND NOT EXISTS (SELECT 1 FROM public.recipient_topic_preferences p WHERE p.email_md5=r.md5 AND NOT (_campaign.topic=ANY(p.topics)))
    AND _campaign.weekly_digest=(EXISTS (SELECT 1 FROM public.recipient_digest_preferences p WHERE p.email_md5=r.md5))
    AND (NOT _campaign.fatigue_protection OR _campaign.weekly_digest
      OR coalesce(public.recipient_fatigue_until(r.md5,_message.id,now())<=now(),true))
    AND (_campaign.sponsor_offer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.sponsor_offers o WHERE o.id=_campaign.sponsor_offer_id AND o.status='active' AND NOT o.delivery_paused
        AND NOT EXISTS (SELECT 1 FROM public.recipient_sponsor_blocks b WHERE b.recipient_md5=r.md5 AND b.brand_id=coalesce(_campaign.sponsor_brand_id,o.brand_id))
    ))
    AND NOT EXISTS (SELECT 1 FROM public.sponsor_purchases p WHERE p.recipient_md5=r.md5 AND p.offer_id=_campaign.sponsor_offer_id AND p.status='approved')
  END
 FROM (SELECT md5(lower(btrim(_message.email))) AS md5) r
$$;

CREATE FUNCTION public.read_campaign_retry_status(_campaign uuid)
RETURNS TABLE(confirmed integer,uncertain integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT count(*) FILTER (WHERE status='failed' AND error='Injection KumoMTA refusée'
   AND injection_uncertain_at IS NULL AND sent_at IS NULL AND delivery_state='pending')::integer,
   count(*) FILTER (WHERE injection_uncertain_at IS NOT NULL)::integer
 FROM public.campaign_messages WHERE campaign_id=_campaign
$$;

CREATE FUNCTION public.retry_confirmed_campaign_messages(_campaign uuid)
RETURNS TABLE(requeued integer,excluded integer,uncertain integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 c public.campaigns;
 counts record;
 number_requeued integer;
BEGIN
 -- Refund handling locks the purchase before the thank-you campaign.
 PERFORM 1 FROM public.sponsor_purchases p JOIN public.campaign_messages m ON m.id=p.thank_you_message_id
 WHERE m.campaign_id=_campaign ORDER BY p.finance_id FOR UPDATE OF p;
 SELECT * INTO c FROM public.campaigns WHERE id=_campaign FOR NO KEY UPDATE;
 IF NOT FOUND OR c.status='cancelled' THEN RAISE EXCEPTION 'Campagne indisponible'; END IF;
 SELECT * INTO counts FROM public.read_campaign_retry_status(_campaign);
 WITH eligible AS MATERIALIZED (
  SELECT m.id FROM public.campaign_messages m
  WHERE m.campaign_id=_campaign AND m.status='failed' AND m.error='Injection KumoMTA refusée'
    AND m.injection_uncertain_at IS NULL AND m.sent_at IS NULL AND m.delivery_state='pending'
    AND NOT EXISTS (SELECT 1 FROM public.campaign_messages child WHERE child.retry_of=m.id)
    AND NOT public.campaign_retry_conflict(m.id)
    AND public.campaign_retry_recipient_ok(c,m)
  ORDER BY m.id FOR UPDATE OF m
 ), retired AS (
  UPDATE public.campaign_messages m SET status='skipped',error='Remplacé après refus confirmé',permit_granted_at=NULL
  FROM eligible e WHERE m.id=e.id AND m.status='failed' AND m.error='Injection KumoMTA refusée'
    AND m.injection_uncertain_at IS NULL AND m.sent_at IS NULL AND m.delivery_state='pending'
  RETURNING m.*
 ), fresh AS (
  INSERT INTO public.campaign_messages(campaign_id,contact_id,email,first_name,server_id,available_at,variant,delivery_wave,send_time_zone,retry_of)
  SELECT m.campaign_id,m.contact_id,m.email,m.first_name,m.server_id,
    greatest(m.available_at,cadence.next_at),m.variant,m.delivery_wave,m.send_time_zone,m.id
  FROM retired m
  LEFT JOIN LATERAL (
   SELECT greatest(
     CASE WHEN c.list_id IS NOT NULL THEN (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) ELSE 0 END,
     CASE WHEN EXISTS (SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5=md5(lower(btrim(m.email)))) THEN 168 ELSE 0 END
   ) AS hours
  ) frequency ON NOT c.purchase_thank_you
  LEFT JOIN LATERAL (
   SELECT greatest(h.sent_at,h.permit_granted_at)+make_interval(hours=>frequency.hours) AS next_at
   FROM public.campaign_messages h WHERE frequency.hours>0 AND h.id<>m.id
    AND md5(lower(btrim(h.email)))=md5(lower(btrim(m.email))) AND (h.sent_at IS NOT NULL OR h.permit_granted_at IS NOT NULL)
   ORDER BY greatest(h.sent_at,h.permit_granted_at) DESC LIMIT 1
  ) cadence ON true
  RETURNING id,retry_of
 ), reassigned_purchase AS (
  UPDATE public.sponsor_purchases p SET thank_you_message_id=n.id
  FROM fresh n WHERE p.thank_you_message_id=n.retry_of
 )
 SELECT count(*)::integer INTO number_requeued FROM fresh;
 IF number_requeued>0 AND c.status='done' THEN
  UPDATE public.campaigns SET status=CASE WHEN c.auto_pause_reason IS NULL THEN 'queued' ELSE 'paused' END WHERE id=_campaign;
 END IF;
 RETURN QUERY SELECT number_requeued,greatest(counts.confirmed-number_requeued,0),counts.uncertain;
END;
$$;

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_retries;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_retries(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 job public.campaign_messages;
 c public.campaigns;
 exclusion text;
BEGIN
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 IF job.retry_of IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(md5(lower(btrim(job.email))),29029));
  SELECT * INTO c FROM public.campaigns WHERE id=job.campaign_id FOR NO KEY UPDATE;
  IF public.campaign_retry_conflict(_id) THEN
   exclusion := 'Reprise arrêtée après confirmation d’un envoi précédent';
  ELSIF NOT public.campaign_retry_recipient_ok(c,job) THEN
   exclusion := 'Reprise écartée après contrôle de l’audience';
  END IF;
 END IF;
 IF exclusion IS NOT NULL THEN
  UPDATE public.campaign_messages SET status='skipped',error=exclusion
  WHERE id=_id AND server_id=_server AND status='claimed' AND permit_granted_at IS NULL;
  IF FOUND THEN
   UPDATE public.campaigns target SET status='done' WHERE target.id=job.campaign_id AND target.status='queued' AND NOT EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=target.id
     AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
   );
  END IF;
  RETURN false;
 END IF;
 RETURN public.agent_may_inject_before_retries(_server,_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_campaign_injections(_server uuid, _receipts jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  repaired integer;
  repaired_campaign_ids uuid[];
BEGIN
  PERFORM c.id FROM public.campaigns c WHERE EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_receipts) AS receipt("messageId" uuid)
    JOIN public.campaign_messages m ON m.id=receipt."messageId" AND m.server_id=_server
    WHERE m.campaign_id=c.id
  ) ORDER BY c.id FOR NO KEY UPDATE;
  WITH updated AS (
    UPDATE public.campaign_messages cm SET
      status='sent', sent_at=coalesce(cm.sent_at, receipt."occurredAt"), injection_uncertain_at=NULL, error=NULL
    FROM jsonb_to_recordset(_receipts) AS receipt("messageId" uuid, recipient text, "occurredAt" timestamptz)
    WHERE cm.server_id=_server AND cm.id=receipt."messageId"
      AND lower(btrim(cm.email))=lower(btrim(receipt.recipient))
      AND receipt."occurredAt" >= cm.created_at - interval '1 second'
      AND receipt."occurredAt" <= now() + interval '5 minutes'
      AND (cm.status='claimed' OR cm.injection_uncertain_at IS NOT NULL
        OR (cm.status='failed' AND cm.error IN ('Injection KumoMTA non confirmée','Injection KumoMTA refusée'))
        OR (cm.status='skipped' AND cm.error='Remplacé après refus confirmé'))
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

CREATE FUNCTION public.close_campaign_if_idle(_campaign uuid,_server uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.campaigns c WHERE c.id=_campaign AND _server=ANY(c.server_ids) FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.campaigns c SET status='done' WHERE c.id=_campaign AND c.status='queued' AND NOT EXISTS (
   SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
    AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
 );
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_retry_conflict(uuid),public.campaign_retry_recipient_ok(public.campaigns,public.campaign_messages)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_campaign_retry_status(uuid),public.retry_confirmed_campaign_messages(uuid),public.close_campaign_if_idle(uuid,uuid),
 public.agent_may_inject(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_campaign_retry_status(uuid),public.retry_confirmed_campaign_messages(uuid),public.close_campaign_if_idle(uuid,uuid),
 public.agent_may_inject(uuid,uuid) TO service_role;
COMMIT;
