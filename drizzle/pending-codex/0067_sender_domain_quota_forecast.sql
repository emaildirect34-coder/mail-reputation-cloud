BEGIN;

CREATE INDEX campaign_pending_from_domain ON public.campaigns (lower(btrim(split_part(from_email,'@',2))))
 WHERE status IN ('queued','paused') AND placement_probe_of IS NULL;

CREATE FUNCTION public.forecast_sender_domain_queue(_domain text,_as_of timestamptz,_through date)
RETURNS TABLE(daily_limit integer,used bigint,cohorts jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH quota AS (
  SELECT q.daily_limit,coalesce(u.used,0) AS used
  FROM public.sender_domain_quotas q LEFT JOIN public.sender_domain_daily_usage u
   ON u.domain=q.domain AND u.utc_day=(_as_of AT TIME ZONE 'UTC')::date
  WHERE q.domain=_domain
 ), pending AS (
  SELECT (slot.ready_at AT TIME ZONE 'UTC')::date AS day,
   ((c.send_expires_at-interval '1 microsecond') AT TIME ZONE 'UTC')::date AS last_day,
   count(*) AS volume
  FROM quota CROSS JOIN public.campaigns c
  JOIN public.campaign_messages m ON m.campaign_id=c.id AND m.status IN ('queued','claimed')
  CROSS JOIN LATERAL (SELECT greatest(_as_of,c.scheduled_at,m.available_at) AS earliest) timing
  CROSS JOIN LATERAL (SELECT coalesce(public.campaign_quiet_next(c,m.send_time_zone,timing.earliest),timing.earliest) AS ready_at) slot
  WHERE lower(btrim(split_part(c.from_email,'@',2)))=_domain
   AND c.status IN ('queued','paused') AND c.placement_probe_of IS NULL
   AND public.campaign_sender_quota_domain(c)=_domain
   AND (c.status='queued' OR c.auto_pause_reason IS NOT NULL)
   AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
   AND m.permit_granted_at IS NULL AND m.sent_at IS NULL AND m.injection_uncertain_at IS NULL
   AND m.delivery_state='pending'
   AND timing.earliest<((_through+1)::timestamp AT TIME ZONE 'UTC')
   AND slot.ready_at<((_through+1)::timestamp AT TIME ZONE 'UTC')
   AND (c.send_expires_at IS NULL OR slot.ready_at<c.send_expires_at)
   AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(m.email))))
  GROUP BY 1,2
 )
 SELECT q.daily_limit,q.used,coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day,p.last_day NULLS LAST) FROM pending p),'[]'::jsonb)
 FROM quota q
$$;

CREATE FUNCTION public.forecast_sender_domain_draft_days(
 _slots jsonb,_window_start integer,_window_end integer,_deadline timestamptz
)
RETURNS TABLE(day date,eligible boolean,volume bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH draft AS (
  SELECT jsonb_populate_record(NULL::public.campaigns,
   jsonb_build_object('send_window_start',_window_start,'send_window_end',_window_end)) AS config
 )
 SELECT (slot.ready_at AT TIME ZONE 'UTC')::date,_deadline IS NULL OR slot.ready_at<_deadline,sum(r.volume)::bigint
 FROM jsonb_to_recordset(_slots) AS r(planned_at timestamptz,zone text,volume integer) CROSS JOIN draft d
 CROSS JOIN LATERAL (SELECT coalesce(public.campaign_quiet_next(d.config,r.zone,r.planned_at),r.planned_at) AS ready_at) slot
 WHERE r.planned_at IS NOT NULL AND r.volume>0 GROUP BY 1,2 ORDER BY 1,2
$$;

REVOKE ALL ON FUNCTION public.forecast_sender_domain_queue(text,timestamptz,date),
 public.forecast_sender_domain_draft_days(jsonb,integer,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.forecast_sender_domain_queue(text,timestamptz,date),
 public.forecast_sender_domain_draft_days(jsonb,integer,integer,timestamptz) TO service_role;
COMMIT;
