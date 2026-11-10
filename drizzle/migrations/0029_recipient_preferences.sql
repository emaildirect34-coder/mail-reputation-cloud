BEGIN;

CREATE TABLE public.recipient_weekly_preferences (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$')
);
ALTER TABLE public.recipient_weekly_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.recipient_weekly_preferences TO service_role;

ALTER TABLE public.campaign_messages ADD COLUMN permit_granted_at timestamptz;
CREATE INDEX campaign_messages_recipient_activity
  ON public.campaign_messages (md5(lower(btrim(email))), GREATEST(sent_at, permit_granted_at) DESC)
  WHERE sent_at IS NOT NULL OR permit_granted_at IS NOT NULL;

CREATE FUNCTION public.read_recipient_preferences(_token text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'brand', c.from_name,
    'weekly', EXISTS (
      SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
    ),
    'suppressed', EXISTS (
      SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(cm.email)))
    )
  )
  FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
  WHERE cm.unsub_token = _token;
$$;

CREATE FUNCTION public.set_recipient_preferences(_token text, _weekly boolean)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _weekly IS NULL THEN RETURN 'invalid'; END IF;
  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  IF _weekly THEN
    INSERT INTO public.recipient_weekly_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.recipient_weekly_preferences p WHERE p.email_md5 = recipient;
  END IF;
  RETURN 'saved';
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
  previous_permit timestamptz;
  previous_activity timestamptz;
  checked_at timestamptz;
BEGIN
  SELECT md5(lower(btrim(cm.email))) INTO recipient
    FROM public.campaign_messages cm WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed';
  IF NOT FOUND THEN RETURN false; END IF;

  -- Serialize a preference change and every permit across servers and campaigns.
  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  checked_at := clock_timestamp();

  SELECT cm.permit_granted_at INTO previous_permit
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= checked_at - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= checked_at)
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient)
    FOR UPDATE OF cm;
  IF NOT FOUND THEN RETURN false; END IF;

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

REVOKE ALL ON FUNCTION public.read_recipient_preferences(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_recipient_preferences(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_recipient_preferences(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_recipient_preferences(text,boolean) TO service_role;
COMMIT;
