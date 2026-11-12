BEGIN;

CREATE INDEX campaign_pending_recipient_lookup ON public.campaign_messages (md5(lower(btrim(email))))
 WHERE status IN ('queued','claimed');

CREATE FUNCTION public.forecast_campaign_conflicts(
 _recipients jsonb, _server uuid, _priority smallint, _as_of timestamptz, _cap_hours integer,
 _window_start integer, _window_end integer
)
RETURNS TABLE(overlap bigint, draft_at_risk bigint, campaigns jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH settings AS (
  SELECT make_interval(hours=>greatest(_cap_hours,24)) AS horizon,
         make_interval(hours=>_cap_hours) AS cap,
         jsonb_populate_record(NULL::public.campaigns,
          jsonb_build_object('send_window_start',_window_start,'send_window_end',_window_end)) AS draft
 ), audience AS MATERIALIZED (
  SELECT r.email_md5,
    min(coalesce(public.campaign_quiet_next(s.draft,r.zone,r.planned_at),r.planned_at)) AS planned_at
  FROM jsonb_to_recordset(_recipients) AS r(email_md5 text,planned_at timestamptz,zone text)
  CROSS JOIN settings s
  WHERE r.email_md5 ~ '^[a-f0-9]{32}$' AND r.planned_at >= _as_of
  GROUP BY r.email_md5
 ), pairs AS (
  SELECT DISTINCT ON (a.email_md5,c.id)
    a.email_md5,c.id,c.name,c.scheduled_at,c.send_priority,c.status,
    a.planned_at AS draft_at, timing.planned_at AS other_at,
    m.server_id,m.status='claimed' AS claimed,m.permit_granted_at IS NOT NULL AS permitted
  FROM audience a
  JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=a.email_md5 AND m.status IN ('queued','claimed')
  JOIN public.campaigns c ON c.id=m.campaign_id
  JOIN public.contact_lists l ON l.id=c.list_id AND l.quarantined_at IS NULL
  CROSS JOIN settings s
  CROSS JOIN LATERAL (SELECT greatest(_as_of,c.scheduled_at,m.available_at) AS earliest) base
  CROSS JOIN LATERAL (
   SELECT coalesce(m.permit_granted_at,public.campaign_quiet_next(c,m.send_time_zone,base.earliest),base.earliest) AS planned_at
  ) timing
  WHERE (c.status='queued' OR (c.status='paused' AND c.scheduled_at IS NOT NULL
   AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'))
    AND timing.planned_at BETWEEN a.planned_at-s.horizon AND a.planned_at+s.horizon
  ORDER BY a.email_md5,c.id,timing.planned_at,(m.permit_granted_at IS NOT NULL) DESC,(m.status='claimed') DESC,m.id
 ), projected AS MATERIALIZED (
  SELECT p.*,
   CASE
    WHEN _cap_hours=0 OR other_at<=draft_at-s.cap OR other_at>=draft_at+s.cap THEN NULL
    WHEN other_at<draft_at OR (other_at=draft_at AND (permitted OR claimed)) THEN 'draft'
    WHEN other_at>draft_at THEN 'other'
    WHEN server_id=_server THEN CASE WHEN _priority>send_priority THEN 'other' ELSE 'draft' END
    ELSE 'uncertain'
   END AS delayed
  FROM pairs p CROSS JOIN settings s
 ), per_campaign AS (
  SELECT id,name,scheduled_at,send_priority,status,
   count(*) AS overlap,
   count(*) FILTER (WHERE delayed='draft') AS draft_delayed,
   count(*) FILTER (WHERE delayed='other') AS other_delayed,
   count(*) FILTER (WHERE delayed='uncertain') AS uncertain
  FROM projected GROUP BY id,name,scheduled_at,send_priority,status
 )
 SELECT (SELECT count(DISTINCT email_md5) FROM projected),
        (SELECT count(DISTINCT email_md5) FROM projected WHERE delayed IN ('draft','uncertain')),
        coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.scheduled_at NULLS FIRST,p.id) FROM per_campaign p),'[]'::jsonb)
$$;

REVOKE ALL ON FUNCTION public.forecast_campaign_conflicts(jsonb,uuid,smallint,timestamptz,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.forecast_campaign_conflicts(jsonb,uuid,smallint,timestamptz,integer,integer,integer) TO service_role;
COMMIT;
