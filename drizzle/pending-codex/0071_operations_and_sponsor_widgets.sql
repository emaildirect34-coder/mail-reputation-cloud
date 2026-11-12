BEGIN;

CREATE INDEX campaign_queue_by_campaign ON public.campaign_messages(campaign_id,available_at)
  WHERE status IN ('queued','claimed');

CREATE FUNCTION public.read_operations_widgets()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH pending AS MATERIALIZED (
   SELECT c.id,c.name,c.status,c.created_at,c.scheduled_at,c.auto_pause_reason,c.send_expires_at
   FROM public.campaigns c
   WHERE c.list_id IS NOT NULL AND c.status IN ('queued','paused')
    AND (c.send_expires_at IS NULL OR c.send_expires_at>now())
 ), due AS MATERIALIZED (
   SELECT m.server_id,public.campaign_recipient_provider(lower(split_part(m.email,'@',2))) AS provider,
     extract(epoch FROM now()-greatest(p.created_at,p.scheduled_at,m.available_at))::bigint AS age
   FROM pending p JOIN public.campaign_messages m ON m.campaign_id=p.id
   WHERE m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL
    AND greatest(p.created_at,p.scheduled_at,m.available_at)<=now()
 ), ages AS (
   SELECT d.server_id,s.label,d.provider,count(*) AS waiting,max(age) AS oldest,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY age) AS median
   FROM due d JOIN public.managed_servers s ON s.id=d.server_id GROUP BY d.server_id,s.label,d.provider
 ), planner AS (
   SELECT p.id,p.name,p.status,p.auto_pause_reason,first_job.next_at
   FROM pending p
   CROSS JOIN LATERAL (
     SELECT min(greatest(p.created_at,p.scheduled_at,m.available_at)) AS next_at
     FROM public.campaign_messages m WHERE m.campaign_id=p.id AND m.status='queued'
       AND greatest(p.created_at,p.scheduled_at,m.available_at) BETWEEN now() AND now()+interval '24 hours'
       AND (p.send_expires_at IS NULL OR greatest(p.created_at,p.scheduled_at,m.available_at)<p.send_expires_at)
   ) first_job
   WHERE first_job.next_at IS NOT NULL ORDER BY first_job.next_at,p.id LIMIT 20
 ), servers AS (
   SELECT s.id,s.label,a.last_seen,scan.observed_through,
     CASE WHEN coalesce(a.vmta_config_hash,a.config_hash) IS NULL THEN NULL
          ELSE coalesce(a.vmta_config_hash,a.config_hash)=a.applied_hash AND a.applied_hash IS NOT NULL END AS applied
   FROM public.managed_servers s LEFT JOIN public.server_agents a ON a.server_id=s.id
   LEFT JOIN public.agent_smtp_scans scan ON scan.server_id=s.id WHERE s.status<>'absent'
 ), recent_reports AS (
   SELECT r.campaign_id,r.date_from,r.date_to
   FROM public.sponsor_conversion_reports r WHERE r.imported_at>=now()-interval '7 days'
   ORDER BY r.imported_at DESC,r.campaign_id,r.date_from,r.date_to LIMIT 10
 )
 SELECT jsonb_build_object(
   'observedAt',now(),
   'openIncidents',(SELECT count(*) FROM public.operations_incidents WHERE resolved_at IS NULL AND signal_cleared_at IS NULL),
   'sponsorAlerts',(SELECT count(*) FROM public.sponsor_link_monitor WHERE alert_since IS NOT NULL AND active_until>now()),
   'unreviewedInjections',(SELECT count(*) FROM public.campaign_messages WHERE injection_uncertain_at IS NOT NULL),
   'recentReports',(SELECT count(*) FROM recent_reports),
   'reportsWithGaps',(SELECT count(*) FROM recent_reports r
     CROSS JOIN LATERAL (SELECT public.read_sponsor_conversion_reconciliation(r.campaign_id,r.date_from,r.date_to,0) AS report) summary
     WHERE (summary.report->>'reported')::bigint<>(summary.report#>>'{counts,matched}')::bigint
        OR (summary.report#>>'{counts,local_only}')::bigint>0),
   'lastSeed',(SELECT max(observed_at) FROM public.campaign_placement_monitors),
   'queue',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.oldest DESC,q.server_id,q.provider) FROM (
     SELECT * FROM ages ORDER BY oldest DESC,server_id,provider LIMIT 25
   ) q),'[]'::jsonb),
   'planner',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.next_at,p.id) FROM planner p),'[]'::jsonb),
   'servers',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.label,s.id) FROM servers s),'[]'::jsonb)
 )
$$;

CREATE TABLE public.sponsor_offer_daily_targets (
  offer_id uuid PRIMARY KEY REFERENCES public.sponsor_offers(id) ON DELETE CASCADE,
  daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 10000000)
);
ALTER TABLE public.sponsor_offer_daily_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_offer_daily_targets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sponsor_offer_daily_targets TO service_role;

CREATE FUNCTION public.read_sponsor_offer_widgets(_offer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH purchases AS MATERIALIZED (
   SELECT p.approved_at,p.consent_at,p.thank_you_message_id,m.clicked_at,m.verified_click_id,
     lower(btrim(m.email)) AS buyer,
     lag(p.approved_at) OVER (PARTITION BY lower(btrim(m.email)) ORDER BY p.approved_at,p.finance_id) AS previous_purchase
   FROM public.sponsor_purchases p JOIN public.campaign_messages m ON m.id=p.source_message_id
   WHERE p.offer_id=_offer AND p.status='approved' AND p.approved_at>=now()-interval '90 days'
 ), people AS (
   SELECT count(DISTINCT buyer) AS buyers,count(DISTINCT buyer) FILTER (WHERE previous_purchase IS NOT NULL) AS repeat_buyers,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM approved_at-previous_purchase)::bigint)
       FILTER (WHERE previous_purchase IS NOT NULL) AS median_repeat_seconds
   FROM purchases
 ), timing AS (
   SELECT count(*) FILTER (WHERE verified_click_id IS NOT NULL AND clicked_at<=approved_at) AS measured,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM approved_at-clicked_at)::bigint)
       FILTER (WHERE verified_click_id IS NOT NULL AND clicked_at<=approved_at) AS median_click_seconds,
     percentile_disc(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM approved_at-clicked_at)::bigint)
       FILTER (WHERE verified_click_id IS NOT NULL AND clicked_at<=approved_at) AS p90_click_seconds
   FROM purchases
 ), followup AS (
   SELECT count(*) AS purchases,count(*) FILTER (WHERE thank_you_message_id IS NOT NULL) AS thank_yous_created,
     count(*) FILTER (WHERE t.delivery_state='delivered' OR EXISTS (
       SELECT 1 FROM public.delivery_events e WHERE e.message_id=t.id AND e.campaign_id=t.campaign_id AND e.event_type='delivered'
     )) AS smtp_accepted,count(*) FILTER (WHERE consent_at IS NOT NULL) AS consent
   FROM purchases p LEFT JOIN public.campaign_messages t ON t.id=p.thank_you_message_id
 ), today AS (
   SELECT count(*) AS confirmed FROM purchases WHERE approved_at>=date_trunc('day',now(),'UTC')
 )
 SELECT jsonb_build_object('people',to_jsonb(people),'timing',to_jsonb(timing),'followup',to_jsonb(followup),
  'today',today.confirmed,'limit',(SELECT daily_limit FROM public.sponsor_offer_daily_targets WHERE offer_id=_offer),
  'resetAt',((now() AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE 'UTC')
 FROM people CROSS JOIN timing CROSS JOIN followup CROSS JOIN today
$$;

REVOKE ALL ON FUNCTION public.read_operations_widgets(),public.read_sponsor_offer_widgets(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_operations_widgets(),public.read_sponsor_offer_widgets(uuid) TO service_role;
COMMIT;
