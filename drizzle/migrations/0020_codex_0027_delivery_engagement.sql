CREATE INDEX delivery_events_engagement_cohort
 ON public.delivery_events(campaign_id,isp,occurred_at,id) INCLUDE (message_id)
 WHERE event_type='delivered' AND smtp_code=250;

CREATE FUNCTION public.delivery_engagement_cohort(_campaign uuid, _isp text)
RETURNS TABLE(first_at timestamptz, last_at timestamptz, accepted integer, engaged integer)
LANGUAGE sql STABLE SET search_path=public AS $$
 WITH first_deliveries AS MATERIALIZED (
  SELECT de.message_id, de.occurred_at
  FROM public.delivery_events de
  WHERE de.campaign_id=_campaign AND de.isp=_isp AND de.event_type='delivered' AND de.smtp_code=250
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_events earlier
      WHERE earlier.campaign_id=de.campaign_id AND earlier.isp=de.isp
        AND earlier.event_type='delivered' AND earlier.smtp_code=250
        AND earlier.message_id=de.message_id
        AND (earlier.occurred_at, earlier.id)<(de.occurred_at, de.id)
    )
  ORDER BY de.occurred_at,de.id
  LIMIT 500
 )
 SELECT min(de.occurred_at),max(de.occurred_at),count(*)::integer,
   count(*) FILTER (
     WHERE cm.opened_at BETWEEN de.occurred_at AND de.occurred_at + interval '15 minutes'
        OR cm.clicked_at BETWEEN de.occurred_at AND de.occurred_at + interval '15 minutes'
   )::integer
 FROM first_deliveries de JOIN public.campaign_messages cm ON cm.id=de.message_id;
$$;

CREATE FUNCTION public.delivery_engagement_anomalies()
RETURNS TABLE(campaign_id uuid, campaign_name text, isp text, first_at timestamptz, accepted integer,
              engaged integer, baseline_campaigns integer, baseline_accepted integer, baseline_engaged integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (
   COALESCE(public.has_role(auth.uid(),'superadmin'),false)
   OR EXISTS (SELECT 1 FROM public.worker_tasks t WHERE t.user_id=auth.uid()
     AND t.status='active' AND '/dashboard/logs'=ANY(t.allowed_paths))
 ) THEN
   RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
 END IF;

 RETURN QUERY
 WITH recent_keys AS MATERIALIZED (
   SELECT d.campaign_id, d.isp
   FROM public.delivery_events d JOIN public.campaigns c ON c.id=d.campaign_id
   WHERE d.event_type='delivered' AND d.smtp_code=250 AND d.isp IN ('Microsoft','Orange')
     AND c.list_id IS NOT NULL AND d.occurred_at >= now()-interval '24 hours'
   GROUP BY d.campaign_id,d.isp ORDER BY max(d.occurred_at) DESC,d.campaign_id,d.isp
   LIMIT 20
 ), flagged AS MATERIALIZED (
   SELECT r.campaign_id,r.isp,a.*
   FROM recent_keys r CROSS JOIN LATERAL public.delivery_engagement_cohort(r.campaign_id,r.isp) a
   WHERE a.accepted=500 AND a.engaged=0 AND a.first_at >= now()-interval '24 hours'
     AND a.last_at <= now()-interval '15 minutes' AND a.last_at <= a.first_at+interval '1 hour'
 ), historical_campaigns AS MATERIALIZED (
   SELECT c.id
   FROM public.campaigns c
   WHERE c.list_id IS NOT NULL AND c.created_at >= now()-interval '28 days' AND c.created_at < now()-interval '24 hours'
   ORDER BY c.created_at DESC,c.id LIMIT 100
 ), history AS MATERIALIZED (
   SELECT targets.isp, a.*
   FROM historical_campaigns c
   CROSS JOIN (SELECT DISTINCT f.isp FROM flagged f) targets
   CROSS JOIN LATERAL public.delivery_engagement_cohort(c.id,targets.isp) a
   WHERE a.accepted=500 AND a.first_at >= now()-interval '28 days'
     AND a.last_at <= now()-interval '24 hours' AND a.last_at <= a.first_at+interval '1 hour'
 ), baselines AS (
   SELECT h.isp, extract(hour FROM h.first_at AT TIME ZONE 'UTC') AS start_hour,
     count(*)::integer AS campaign_count, sum(h.accepted)::integer AS total, sum(h.engaged)::integer AS tracked
   FROM history h GROUP BY h.isp,extract(hour FROM h.first_at AT TIME ZONE 'UTC')
   HAVING count(*)>=3 AND sum(h.engaged)*20>=sum(h.accepted)
 )
 SELECT f.campaign_id,c.name,f.isp,f.first_at,f.accepted,f.engaged,b.campaign_count,b.total,b.tracked
 FROM flagged f JOIN public.campaigns c ON c.id=f.campaign_id
 JOIN baselines b ON b.isp=f.isp AND b.start_hour=extract(hour FROM f.first_at AT TIME ZONE 'UTC')
 ORDER BY f.first_at DESC,f.campaign_id,f.isp;
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_engagement_cohort(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delivery_engagement_anomalies() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_engagement_anomalies() TO authenticated;