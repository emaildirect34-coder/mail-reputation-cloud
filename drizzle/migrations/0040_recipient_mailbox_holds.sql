BEGIN;

CREATE TABLE public.recipient_mailbox_holds (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  until_at timestamptz NOT NULL
);
ALTER TABLE public.recipient_mailbox_holds ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.recipient_mailbox_holds TO service_role;

CREATE FUNCTION public.record_mailbox_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.occurred_at > clock_timestamp() + interval '5 minutes'
     OR NEW.occurred_at + interval '336 hours' <= clock_timestamp() THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.recipient_mailbox_holds AS h (email_md5, until_at)
  VALUES (md5(lower(btrim(NEW.recipient))), NEW.occurred_at + interval '336 hours')
  ON CONFLICT (email_md5) DO UPDATE SET until_at = EXCLUDED.until_at
    WHERE h.until_at <= NEW.occurred_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mailbox_hold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mailbox_hold() TO service_role;

CREATE TRIGGER delivery_event_mailbox_hold
  AFTER INSERT ON public.delivery_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'deferred' AND NEW.smtp_code = 452 AND NEW.detail ~ '^4[.]2[.]2([^0-9.]|$)')
  EXECUTE FUNCTION public.record_mailbox_hold();

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

  SELECT cm.permit_granted_at, c.topic, c.weekly_digest INTO previous_permit, campaign_topic, is_digest
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

  UPDATE public.campaign_messages SET permit_granted_at = checked_at WHERE id = _id;
  RETURN true;
END;
$$;

COMMIT;
