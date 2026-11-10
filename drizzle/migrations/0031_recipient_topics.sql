BEGIN;

ALTER TABLE public.campaigns ADD COLUMN topic text CHECK (topic IN ('news','offers','events','education'));

CREATE TABLE public.recipient_topic_preferences (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  topics text[] NOT NULL CHECK (
    cardinality(topics) BETWEEN 1 AND 4
    AND array_position(topics, NULL) IS NULL
    AND topics <@ ARRAY['news','offers','events','education']
  )
);
ALTER TABLE public.recipient_topic_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_topic_preferences TO service_role;

CREATE OR REPLACE FUNCTION public.read_recipient_preferences(_token text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'brand', c.from_name,
    'weekly', EXISTS (
      SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
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

CREATE FUNCTION public.set_recipient_topics(_token text, _topics text[])
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _topics IS NOT NULL AND (
    cardinality(_topics) NOT BETWEEN 1 AND 4
    OR array_ndims(_topics) IS DISTINCT FROM 1
    OR NOT (_topics <@ ARRAY['news','offers','events','education'])
    OR cardinality(_topics) <> (SELECT count(DISTINCT topic) FROM unnest(_topics) topic)
  ) THEN RETURN 'invalid'; END IF;

  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  IF _topics IS NULL THEN
    DELETE FROM public.recipient_topic_preferences p WHERE p.email_md5 = recipient;
  ELSE
    INSERT INTO public.recipient_topic_preferences(email_md5, topics) VALUES (recipient, _topics)
    ON CONFLICT (email_md5) DO UPDATE SET topics = EXCLUDED.topics;
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
  previous_permit timestamptz;
  previous_activity timestamptz;
  checked_at timestamptz;
BEGIN
  SELECT md5(lower(btrim(cm.email))), cm.campaign_id INTO recipient, campaign_id_for_message
    FROM public.campaign_messages cm WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed';
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  SELECT p.topics INTO allowed_topics FROM public.recipient_topic_preferences p WHERE p.email_md5 = recipient;

  -- Before closing an excluded job, lock the campaign first, as event ingestion does.
  IF allowed_topics IS NOT NULL THEN
    PERFORM 1 FROM public.campaigns c
      WHERE c.id = campaign_id_for_message AND NOT (c.topic = ANY(allowed_topics))
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

  IF NOT (campaign_topic = ANY(allowed_topics)) THEN
    UPDATE public.campaign_messages SET status = 'failed', error = 'Thème non choisi dans les préférences' WHERE id = _id;
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

REVOKE ALL ON FUNCTION public.set_recipient_topics(text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_recipient_topics(text,text[]) TO service_role;
COMMIT;
