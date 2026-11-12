CREATE TABLE public.recipient_snoozes (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  until_at timestamptz NOT NULL
);
ALTER TABLE public.recipient_snoozes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipient_snoozes TO service_role;

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

REVOKE ALL ON FUNCTION public.set_recipient_snooze(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_recipient_snooze(text,integer) TO service_role;

CREATE INDEX contacts_active_list_cursor ON public.contacts(list_id, id) WHERE status = 'active';

CREATE FUNCTION public.campaign_audience_page(_list uuid, _after uuid, _with_time_zone boolean)
RETURNS TABLE(id uuid, email text, first_name text, time_zone text, suppressed boolean)
LANGUAGE sql STABLE SET search_path=public AS $$
  WITH page AS MATERIALIZED (
    SELECT c.id, c.email, c.first_name, c.time_zone, c.email_md5
    FROM public.contacts c
    WHERE c.list_id = _list AND c.status = 'active' AND (_after IS NULL OR c.id > _after)
    ORDER BY c.id LIMIT 1000
  )
  SELECT p.id, p.email, p.first_name, CASE WHEN _with_time_zone THEN p.time_zone END,
    EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = p.email_md5)
  FROM page p ORDER BY p.id;
$$;

REVOKE ALL ON FUNCTION public.campaign_audience_page(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_audience_page(uuid,uuid,boolean) TO service_role;

ALTER TABLE public.delivery_events ADD COLUMN source_ipv4 text;
CREATE INDEX delivery_events_source_history ON public.delivery_events(server_id, occurred_at)
  WHERE source_ipv4 IS NOT NULL AND event_type IN ('delivered', 'bounce');

CREATE FUNCTION public.ingest_attributed_delivery_events(_server uuid, _events jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE accepted integer;
BEGIN
  accepted := public.ingest_delivery_events(_server, _events);
  UPDATE public.delivery_events e SET source_ipv4 = ip.address
  FROM jsonb_array_elements(_events) AS incoming(payload)
  JOIN public.server_ips ip ON ip.server_id = _server AND ip.family = 4 AND ip.address = incoming.payload->>'sourceIpv4'
  WHERE e.server_id = _server AND e.event_key = incoming.payload->>'eventKey'
    AND e.message_id = (incoming.payload->>'messageId')::uuid
    AND e.source_ipv4 IS NULL AND e.event_type IN ('delivered', 'bounce')
    AND incoming.payload->>'type' = e.event_type;
  RETURN accepted;
END;
$$;

CREATE FUNCTION public.source_isp_history(_server uuid, _domains text[])
RETURNS TABLE(server_id uuid, source_ipv4 text, domain text, delivered bigint, sample bigint)
LANGUAGE sql STABLE SET search_path=public AS $$
  WITH terminal AS (
    SELECT DISTINCT ON (e.server_id, e.source_ipv4, e.message_id) e.server_id, e.source_ipv4,
      lower(split_part(e.recipient, '@', 2)) AS domain, e.event_type
    FROM public.delivery_events e
    WHERE (_server IS NULL OR e.server_id = _server) AND e.source_ipv4 IS NOT NULL
      AND e.event_type IN ('delivered', 'bounce') AND (e.smtp_code BETWEEN 200 AND 299 OR e.smtp_code BETWEEN 500 AND 599)
      AND e.occurred_at >= now() - interval '8 days' AND e.occurred_at < now() - interval '24 hours'
      AND lower(split_part(e.recipient, '@', 2)) = ANY(_domains)
    ORDER BY e.server_id, e.source_ipv4, e.message_id, e.occurred_at DESC, e.id DESC
  )
  SELECT t.server_id, t.source_ipv4, t.domain, count(*) FILTER (WHERE t.event_type = 'delivered'), count(*)
  FROM terminal t GROUP BY t.server_id, t.source_ipv4, t.domain;
$$;

REVOKE ALL ON FUNCTION public.ingest_attributed_delivery_events(uuid,jsonb), public.source_isp_history(uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_attributed_delivery_events(uuid,jsonb), public.source_isp_history(uuid,text[]) TO service_role;

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

CREATE FUNCTION public.agent_confirm_suppressions(_server uuid, _ids uuid[])
RETURNS uuid[] LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  removed uuid[];
  campaigns uuid[];
BEGIN
  IF _ids IS NULL OR cardinality(_ids) > 200 THEN RAISE EXCEPTION 'Invalid suppression batch'; END IF;
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO campaigns
  FROM public.campaigns c WHERE EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id = c.id AND m.server_id = _server
      AND m.id = ANY(_ids) AND m.status = 'claimed' AND m.permit_granted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(m.email))))
  );
  PERFORM c.id FROM public.campaigns c WHERE c.id = ANY(campaigns) ORDER BY c.id FOR NO KEY UPDATE;

  WITH discarded AS (
    UPDATE public.campaign_messages m SET status = 'failed', error = 'Destinataire supprimé avant injection'
    WHERE m.server_id = _server AND m.campaign_id = ANY(campaigns) AND m.id = ANY(_ids) AND m.status = 'claimed' AND m.permit_granted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(m.email))))
    RETURNING m.id
  ) SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO removed FROM discarded;

  IF cardinality(removed) > 0 THEN
    UPDATE public.campaigns c SET status = 'done'
    WHERE c.id = ANY(campaigns) AND c.status = 'queued' AND NOT EXISTS (
      SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id = c.id AND m.status IN ('queued', 'claimed')
    );
  END IF;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_confirm_suppressions(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_confirm_suppressions(uuid,uuid[]) TO service_role;

CREATE INDEX IF NOT EXISTS delivery_events_message_trace
  ON public.delivery_events(message_id, occurred_at DESC, id DESC);