BEGIN;

ALTER TABLE public.sponsor_purchases ADD COLUMN recipient_md5 text;
UPDATE public.sponsor_purchases p SET recipient_md5=md5(lower(btrim(m.email)))
FROM public.campaign_messages m WHERE m.id=p.source_message_id;
ALTER TABLE public.sponsor_purchases ALTER COLUMN recipient_md5 SET NOT NULL;
CREATE INDEX sponsor_purchases_approved_recipient
  ON public.sponsor_purchases(offer_id,recipient_md5) WHERE status='approved';

ALTER TABLE public.campaign_messages DROP CONSTRAINT campaign_messages_status_check;
ALTER TABLE public.campaign_messages ADD CONSTRAINT campaign_messages_status_check
  CHECK (status IN ('queued','claimed','sent','failed','skipped'));
CREATE INDEX campaign_messages_pending_recipient
  ON public.campaign_messages (md5(lower(btrim(email))),campaign_id)
  WHERE status IN ('queued','claimed') AND permit_granted_at IS NULL;

CREATE FUNCTION public.skip_sponsor_followups(_offer uuid,_recipient text,_message uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  campaign uuid;
  skipped_count integer;
BEGIN
  -- Match the campaign-before-message lock order used by delivery ingestion.
  FOR campaign IN
    SELECT c.id FROM public.campaigns c
    WHERE c.sponsor_offer_id=_offer AND NOT c.purchase_thank_you AND c.status IN ('queued','paused')
      AND EXISTS (
        SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
          AND md5(lower(btrim(m.email)))=_recipient
          AND m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL
          AND (_message IS NULL OR m.id=_message)
      )
    ORDER BY c.id FOR NO KEY UPDATE OF c
  LOOP
    UPDATE public.campaign_messages m SET status='skipped', error='Relance arrêtée après achat de cette offre'
    WHERE m.campaign_id=campaign AND md5(lower(btrim(m.email)))=_recipient
      AND m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL
      AND (_message IS NULL OR m.id=_message);
    GET DIAGNOSTICS skipped_count=ROW_COUNT;
    IF skipped_count > 0 THEN
      UPDATE public.campaigns c SET suppressed=c.suppressed+skipped_count,
        status=CASE WHEN c.status='queued' AND NOT EXISTS (
          SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
            AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
        ) THEN 'done' ELSE c.status END
      WHERE c.id=campaign;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.apply_sponsor_purchase_followup_stop()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT md5(lower(btrim(email))) INTO NEW.recipient_md5
    FROM public.campaign_messages WHERE id=NEW.source_message_id;
  ELSIF NEW.status=OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('approved','rejected') THEN
    -- Serialize purchase transitions with the existing per-recipient injection permit.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.recipient_md5,29029));
    IF NEW.status='approved' THEN
      PERFORM public.skip_sponsor_followups(NEW.offer_id,NEW.recipient_md5);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsor_purchase_followup_stop
  BEFORE INSERT OR UPDATE OF status ON public.sponsor_purchases
  FOR EACH ROW EXECUTE FUNCTION public.apply_sponsor_purchase_followup_stop();

CREATE FUNCTION public.close_empty_sponsor_campaign_on_resume()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- A purchase can clear a campaign while its batches are still being prepared.
  IF EXISTS (
    SELECT 1 FROM public.campaign_messages WHERE campaign_id=NEW.id AND status='skipped'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.campaign_messages WHERE campaign_id=NEW.id
      AND (status IN ('queued','claimed') OR injection_uncertain_at IS NOT NULL)
  ) THEN
    NEW.status := 'done';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER close_empty_sponsor_campaign_on_resume
  BEFORE UPDATE OF status ON public.campaigns
  FOR EACH ROW WHEN (OLD.status='paused' AND NEW.status='queued' AND NEW.sponsor_offer_id IS NOT NULL)
  EXECUTE FUNCTION public.close_empty_sponsor_campaign_on_resume();

CREATE FUNCTION public.sponsor_followup_blocked_contacts(_offer uuid,_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.id FROM public.contacts c
  WHERE c.id=ANY(_ids) AND EXISTS (
    SELECT 1 FROM public.sponsor_purchases p
    WHERE p.offer_id=_offer AND p.recipient_md5=c.email_md5 AND p.status='approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  recipient text;
  offer uuid;
  thank_you boolean;
BEGIN
  SELECT md5(lower(btrim(m.email))),c.sponsor_offer_id,c.purchase_thank_you
    INTO recipient,offer,thank_you
    FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
    WHERE m.id=_id AND m.server_id=_server AND m.status='claimed';
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT thank_you AND offer IS NULL THEN RETURN public.agent_may_inject_marketing(_server,_id); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient,29029));
  IF NOT thank_you THEN
    IF EXISTS (
      SELECT 1 FROM public.sponsor_purchases p
      WHERE p.offer_id=offer AND p.recipient_md5=recipient AND p.status='approved'
    ) THEN
      PERFORM public.skip_sponsor_followups(offer,recipient,_id);
      RETURN false;
    END IF;
    RETURN public.agent_may_inject_marketing(_server,_id);
  END IF;

  UPDATE public.campaign_messages m SET permit_granted_at=clock_timestamp()
    FROM public.campaigns c
    WHERE m.id=_id AND m.server_id=_server AND c.id=m.campaign_id
      AND m.status='claimed' AND m.claimed_at >= clock_timestamp()-interval '15 minutes'
      AND m.permit_granted_at IS NULL AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5=recipient)
      AND NOT EXISTS (SELECT 1 FROM public.recipient_mailbox_holds WHERE email_md5=recipient AND until_at > clock_timestamp())
      AND EXISTS (SELECT 1 FROM public.sponsor_purchases WHERE thank_you_message_id=m.id AND status='approved');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_can_claim(_campaign public.campaigns, _server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _campaign.status='queued' AND _campaign.auto_pause_reason IS NULL
   AND (_campaign.scheduled_at IS NULL OR _campaign.scheduled_at <= now())
   AND NOT EXISTS (
     SELECT 1 FROM public.contact_lists
     WHERE id=_campaign.list_id AND quarantined_at IS NOT NULL
   )
   AND EXISTS (
     SELECT 1 FROM public.server_agents agent
     WHERE agent.server_id=_server
     AND (NOT (_campaign.purchase_thank_you OR _campaign.sponsor_offer_id IS NOT NULL
              OR _campaign.weekly_digest OR _campaign.fatigue_protection
              OR (_campaign.list_id IS NOT NULL AND (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) > 0))
          OR agent.metrics->>'preferencePermit' = 'true')
     AND CASE
       WHEN agent.metrics->>'vmtaRouting' = 'true'
        AND substring(agent.kumo_version FROM '^kumod ([0-9]{4}\.[0-9]{2}\.[0-9]{2})') >= '2026.09.29'
       THEN agent.status='online' AND agent.vmta_config_hash IS NOT NULL
        AND agent.applied_hash=agent.vmta_config_hash
        AND EXISTS (
          SELECT 1 FROM public.server_ips ip
          LEFT JOIN public.vmta_pools pool ON pool.id=ip.pool_id
          WHERE ip.server_id=_server AND ip.active AND ip.family=4 AND ip.quarantined_at IS NULL
          AND (
            (_campaign.vmta_pool_id IS NULL AND ip.pool_id IS NULL)
            OR (pool.purpose='marketing' AND pool.status='active'
                AND (_campaign.vmta_pool_id IS NULL OR pool.id=_campaign.vmta_pool_id))
          )
        )
       ELSE false
     END
   );
$$;

REVOKE ALL ON FUNCTION public.skip_sponsor_followups(uuid,text,uuid),
  public.apply_sponsor_purchase_followup_stop(),
  public.close_empty_sponsor_campaign_on_resume()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sponsor_followup_blocked_contacts(uuid,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_followup_blocked_contacts(uuid,uuid[]) TO service_role;
COMMIT;
