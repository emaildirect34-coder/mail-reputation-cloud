BEGIN;

CREATE TABLE public.recipient_snoozes (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  until_at timestamptz NOT NULL
);
ALTER TABLE public.recipient_snoozes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_snoozes TO service_role;

CREATE OR REPLACE FUNCTION public.read_recipient_preferences(_token text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'brand', c.from_name,
    'weekly', EXISTS (
      SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
    ),
    'snoozed_until', (
      SELECT p.until_at FROM public.recipient_snoozes p WHERE p.email_md5 = md5(lower(btrim(cm.email))) AND p.until_at > now()
    ),
    'topics', (
      SELECT p.topics FROM public.recipient_topic_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
    ),
    'suppressed', EXISTS (
      SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(cm.email)))
    )
  )
  FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
  WHERE cm.unsub_token = _token;
$$;

CREATE FUNCTION public.set_recipient_snooze(_token text, _days integer)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _days IS NULL OR _days NOT IN (0, 30, 60) THEN RETURN 'invalid'; END IF;
  SELECT md5(lower(btrim(cm.email))) INTO recipient
    FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  IF _days = 0 THEN
    DELETE FROM public.recipient_snoozes p WHERE p.email_md5 = recipient;
  ELSE
    INSERT INTO public.recipient_snoozes(email_md5, until_at)
      VALUES (recipient, clock_timestamp() + _days * interval '24 hours')
    ON CONFLICT (email_md5) DO UPDATE SET until_at = EXCLUDED.until_at;
  END IF;
  RETURN 'saved';
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
  campaign_id_for_message uuid;
  campaign_topic text;
  allowed_topics text[];
  snoozed_until timestamptz;
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

  -- Before closing an excluded job, lock the campaign first, as event ingestion does.
  IF allowed_topics IS NOT NULL OR snoozed_until > clock_timestamp() THEN
    PERFORM 1 FROM public.campaigns c
      WHERE c.id = campaign_id_for_message AND (NOT (c.topic = ANY(allowed_topics)) OR snoozed_until > clock_timestamp())
      FOR NO KEY UPDATE OF c;
  END IF;
  checked_at := clock_timestamp();

  SELECT cm.permit_granted_at, c.topic INTO previous_permit, campaign_topic
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= checked_at - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= checked_at)
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient)
    FOR UPDATE OF cm;
  IF NOT FOUND THEN RETURN false; END IF;

  IF snoozed_until > checked_at OR NOT (campaign_topic = ANY(allowed_topics)) THEN
    UPDATE public.campaign_messages SET status = 'failed',
      error = CASE WHEN snoozed_until > checked_at THEN 'Envois en pause a la demande du destinataire'
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

REVOKE ALL ON FUNCTION public.set_recipient_snooze(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_recipient_snooze(text,integer) TO service_role;

COMMIT;
