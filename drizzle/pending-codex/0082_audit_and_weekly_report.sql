BEGIN;

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 80),
  entity_id text CHECK (entity_id IS NULL OR length(entity_id)<=160),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(summary::text)<=4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent ON public.audit_log(created_at DESC,id DESC);
CREATE INDEX audit_log_entity ON public.audit_log(entity_type,entity_id,created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.audit_log TO service_role;

CREATE FUNCTION public.read_weekly_operations_report(_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH bounds AS (SELECT _now-interval '7 days' AS since_at,_now AS until_at),
  campaign_counts AS (
    SELECT count(*)::bigint AS created,
      count(*) FILTER (WHERE c.status='done')::bigint AS completed,
      count(*) FILTER (WHERE c.status='paused')::bigint AS paused
    FROM public.campaigns c,bounds b WHERE c.created_at>=b.since_at AND c.created_at<b.until_at
      AND c.placement_probe_of IS NULL
  ),
  message_counts AS (
    SELECT count(*) FILTER (WHERE m.sent_at>=b.since_at AND m.sent_at<b.until_at)::bigint AS injected,
      count(*) FILTER (WHERE m.status='failed' AND m.created_at>=b.since_at AND m.created_at<b.until_at)::bigint AS failed
    FROM public.campaign_messages m,bounds b
  ),
  event_counts AS (
    SELECT count(*) FILTER (WHERE e.event_type='delivered')::bigint AS smtp_accepted,
      count(*) FILTER (WHERE e.event_type='bounce')::bigint AS bounces,
      count(*) FILTER (WHERE e.event_type='deferred')::bigint AS deferred,
      count(*) FILTER (WHERE e.event_type='complaint')::bigint AS complaints
    FROM public.delivery_events e,bounds b WHERE e.occurred_at>=b.since_at AND e.occurred_at<b.until_at
  ),
  incident_counts AS (
    SELECT count(*) FILTER (WHERE i.started_at>=b.since_at AND i.started_at<b.until_at)::bigint AS opened,
      count(*) FILTER (WHERE i.resolved_at>=b.since_at AND i.resolved_at<b.until_at)::bigint AS resolved,
      count(*) FILTER (WHERE i.resolved_at IS NULL)::bigint AS still_open
    FROM public.operations_incidents i,bounds b
  )
  SELECT jsonb_build_object(
    'since',b.since_at,'until',b.until_at,'campaigns',to_jsonb(c),
    'messages',to_jsonb(m),'smtp',to_jsonb(e),'incidents',to_jsonb(i)
  ) FROM bounds b CROSS JOIN campaign_counts c CROSS JOIN message_counts m
    CROSS JOIN event_counts e CROSS JOIN incident_counts i;
$$;
REVOKE ALL ON FUNCTION public.read_weekly_operations_report(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_weekly_operations_report(timestamptz) TO service_role;

COMMIT;
