BEGIN;

CREATE TABLE public.campaign_frequency_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hours integer NOT NULL DEFAULT 0 CHECK (hours IN (0,24,48))
);
INSERT INTO public.campaign_frequency_policy DEFAULT VALUES;
ALTER TABLE public.campaign_frequency_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_frequency_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.campaign_frequency_policy TO service_role;

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
     AND (NOT (_campaign.weekly_digest OR _campaign.fatigue_protection OR (_campaign.list_id IS NOT NULL AND (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) > 0)) OR agent.metrics->>'preferencePermit' = 'true')
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

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
  campaign_id_for_message uuid;
  campaign_topic text;
  allowed_topics text[];
  snoozed_until timestamptz;
  wants_digest boolean;
  is_digest boolean;
  fatigue_until timestamptz;
  mailbox_hold_until timestamptz;
  previous_permit timestamptz;
  cap_hours integer;
  previous_activity timestamptz;
  checked_at timestamptz;
BEGIN
  SELECT md5(lower(btrim(cm.email))), cm.campaign_id INTO recipient, campaign_id_for_message
    FROM public.campaign_messages cm WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed';
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  SELECT p.topics INTO allowed_topics FROM public.recipient_topic_preferences p WHERE p.email_md5 = recipient;

  SELECT p.until_at INTO snoozed_until FROM public.recipient_snoozes p WHERE p.email_md5 = recipient;

  SELECT EXISTS (SELECT 1 FROM public.recipient_digest_preferences p WHERE p.email_md5 = recipient) INTO wants_digest;

  SELECT public.recipient_fatigue_until(recipient, _id, clock_timestamp()) INTO fatigue_until
    FROM public.campaigns c WHERE c.id = campaign_id_for_message AND c.fatigue_protection AND NOT c.weekly_digest;

  SELECT h.until_at INTO mailbox_hold_until FROM public.recipient_mailbox_holds h WHERE h.email_md5 = recipient;

  -- Before closing an excluded job, lock the campaign first, as event ingestion does.
    PERFORM 1 FROM public.campaigns c
      WHERE c.id = campaign_id_for_message AND (c.weekly_digest <> wants_digest OR NOT (c.topic = ANY(allowed_topics)) OR snoozed_until > clock_timestamp() OR fatigue_until > clock_timestamp() OR mailbox_hold_until > clock_timestamp())
      FOR NO KEY UPDATE OF c;
  checked_at := clock_timestamp();

  SELECT cm.permit_granted_at, c.topic, c.weekly_digest, CASE WHEN c.list_id IS NOT NULL THEN (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) ELSE 0 END INTO previous_permit, campaign_topic, is_digest, cap_hours
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= checked_at - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= checked_at)
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient)
    FOR UPDATE OF cm;
  IF NOT FOUND THEN RETURN false; END IF;

  IF is_digest <> wants_digest OR snoozed_until > checked_at OR fatigue_until > checked_at OR mailbox_hold_until > checked_at OR NOT (campaign_topic = ANY(allowed_topics)) THEN
    UPDATE public.campaign_messages SET status = 'failed',
      error = CASE WHEN snoozed_until > checked_at THEN 'Envois en pause a la demande du destinataire'
        WHEN mailbox_hold_until > checked_at THEN 'Boîte pleine, suspension temporaire des campagnes'
        WHEN fatigue_until > checked_at THEN 'Cadence de protection du destinataire'
        WHEN is_digest <> wants_digest THEN 'Format non choisi dans les preferences'
        ELSE 'Thème non choisi dans les préférences' END
      WHERE id = _id;
    UPDATE public.campaigns c SET status = 'done'
      WHERE c.id = campaign_id_for_message AND c.status = 'queued' AND NOT EXISTS (
        SELECT 1 FROM public.campaign_messages cm WHERE cm.campaign_id = c.id AND cm.status IN ('queued','claimed')
      );
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = recipient) THEN
    IF previous_permit IS NOT NULL THEN
      -- We cannot prove a previous permit did not result in injection. Do not replay it.
      UPDATE public.campaign_messages SET status = 'failed', error = 'Envoi hebdomadaire déjà autorisé, résultat non confirmé'
        WHERE id = _id;
      RETURN false;
    END IF;

    SELECT GREATEST(cm.sent_at, cm.permit_granted_at) INTO previous_activity
      FROM public.campaign_messages cm
      WHERE md5(lower(btrim(cm.email))) = recipient AND (cm.sent_at IS NOT NULL OR cm.permit_granted_at IS NOT NULL)
      ORDER BY GREATEST(cm.sent_at, cm.permit_granted_at) DESC LIMIT 1;
    IF previous_activity + interval '168 hours' > checked_at THEN
      UPDATE public.campaign_messages SET status = 'queued', claimed_at = NULL,
        available_at = previous_activity + interval '168 hours'
        WHERE id = _id;
      RETURN false;
    END IF;
  END IF;

  IF cap_hours > 0 THEN
    -- A concurrent campaign for the same address sees this permit before it can inject.
    IF previous_permit IS NOT NULL THEN RETURN false; END IF;
    SELECT greatest(cm.sent_at, cm.permit_granted_at) INTO previous_activity
    FROM public.campaign_messages cm
    WHERE cm.id <> _id AND md5(lower(btrim(cm.email))) = recipient
      AND (cm.sent_at IS NOT NULL OR cm.permit_granted_at IS NOT NULL)
      AND greatest(cm.sent_at, cm.permit_granted_at) > checked_at - make_interval(hours => cap_hours)
    ORDER BY greatest(cm.sent_at, cm.permit_granted_at) DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.campaign_messages SET status='queued', claimed_at=NULL,
        available_at=previous_activity + make_interval(hours => cap_hours)
      WHERE id=_id;
      RETURN false;
    END IF;
  END IF;

  UPDATE public.campaign_messages SET permit_granted_at = checked_at WHERE id = _id;
  RETURN true;
END;
$$;

COMMIT;
