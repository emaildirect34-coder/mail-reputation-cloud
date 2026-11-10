BEGIN;

ALTER TABLE public.campaigns ADD COLUMN weekly_digest boolean NOT NULL DEFAULT false;
CREATE TABLE public.recipient_digest_preferences (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$')
);
ALTER TABLE public.recipient_digest_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.recipient_digest_preferences TO service_role;

CREATE OR REPLACE FUNCTION public.read_recipient_preferences(_token text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'brand', c.from_name,
    'digest', EXISTS (
      SELECT 1 FROM public.recipient_digest_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
    ),
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

CREATE OR REPLACE FUNCTION public.set_recipient_preferences(_token text, _weekly boolean)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _weekly IS NULL THEN RETURN 'invalid'; END IF;
  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  DELETE FROM public.recipient_digest_preferences p WHERE p.email_md5 = recipient;
  IF _weekly THEN
    INSERT INTO public.recipient_weekly_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.recipient_weekly_preferences p WHERE p.email_md5 = recipient;
  END IF;
  RETURN 'saved';
END;
$$;

CREATE FUNCTION public.set_recipient_digest(_token text)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE recipient text;
BEGIN
  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;
  INSERT INTO public.recipient_weekly_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  INSERT INTO public.recipient_digest_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  RETURN 'saved';
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
     AND (NOT _campaign.weekly_digest OR agent.metrics->>'preferencePermit' = 'true')
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

  -- Before closing an excluded job, lock the campaign first, as event ingestion does.
    PERFORM 1 FROM public.campaigns c
      WHERE c.id = campaign_id_for_message AND (c.weekly_digest <> wants_digest OR NOT (c.topic = ANY(allowed_topics)) OR snoozed_until > clock_timestamp())
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

  IF is_digest <> wants_digest OR snoozed_until > checked_at OR NOT (campaign_topic = ANY(allowed_topics)) THEN
    UPDATE public.campaign_messages SET status = 'failed',
      error = CASE WHEN snoozed_until > checked_at THEN 'Envois en pause a la demande du destinataire'
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

CREATE FUNCTION public.campaign_audience_page(_list uuid, _after uuid, _with_time_zone boolean, _digest boolean)
RETURNS TABLE(id uuid, email text, first_name text, time_zone text, suppressed boolean, format_excluded boolean)
LANGUAGE sql STABLE SET search_path=public AS $$
  WITH page AS MATERIALIZED (
    SELECT c.id, c.email, c.first_name, c.time_zone, c.email_md5
    FROM public.contacts c
    WHERE c.list_id = _list AND c.status = 'active' AND (_after IS NULL OR c.id > _after)
    ORDER BY c.id LIMIT 1000
  )
  SELECT p.id, p.email, p.first_name, CASE WHEN _with_time_zone THEN p.time_zone END,
    EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = p.email_md5),
    _digest <> EXISTS (SELECT 1 FROM public.recipient_digest_preferences d WHERE d.email_md5 = p.email_md5)
  FROM page p ORDER BY p.id;
$$;

REVOKE ALL ON FUNCTION public.set_recipient_digest(text), public.campaign_audience_page(uuid,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_recipient_digest(text), public.campaign_audience_page(uuid,uuid,boolean,boolean) TO service_role;
COMMIT;
