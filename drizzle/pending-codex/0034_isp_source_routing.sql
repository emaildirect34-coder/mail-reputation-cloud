BEGIN;

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

COMMIT;
