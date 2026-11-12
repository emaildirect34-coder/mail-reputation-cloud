BEGIN;

-- Keep the holdout audience queued until the testing window is decided.
ALTER FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages) RENAME TO campaign_job_ready_before_ab_holdout;
CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT (_campaign.ab_variants IS NULL OR _campaign.ab_winner IS NOT NULL OR _message.variant IS NOT NULL)
   AND public.campaign_job_ready_before_ab_holdout(_campaign,_message)
$$;

CREATE FUNCTION public.decide_ab_winners()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 WITH candidate AS (
   SELECT c.id,CASE WHEN jsonb_typeof(c.ab_variants)='array' THEN jsonb_array_length(c.ab_variants) ELSE 0 END AS variant_count
   FROM public.campaigns c WHERE c.ab_variants IS NOT NULL AND c.ab_winner IS NULL
     AND c.ab_decide_at IS NOT NULL AND c.ab_decide_at<=clock_timestamp()
     AND jsonb_typeof(c.ab_variants)='array' AND jsonb_array_length(c.ab_variants) BETWEEN 2 AND 3
 ), variant AS (
   SELECT c.id,g.idx,count(m.id) FILTER (WHERE m.sent_at IS NOT NULL OR m.status='sent')::bigint AS attempted,
     count(m.id) FILTER (WHERE CASE c.ab_metric WHEN 'click' THEN m.clicked_at IS NOT NULL ELSE m.opened_at IS NOT NULL END)::bigint AS engaged
   FROM candidate c JOIN public.campaigns c0 ON c0.id=c.id
   CROSS JOIN LATERAL generate_series(0,c.variant_count-1) g(idx)
   LEFT JOIN public.campaign_messages m ON m.campaign_id=c.id AND m.variant=g.idx
   GROUP BY c.id,g.idx,c0.ab_metric
 ), eligible AS (
   SELECT id FROM variant GROUP BY id HAVING bool_and(attempted>0)
 ), winner AS (
   SELECT DISTINCT ON (v.id) v.id,v.idx
   FROM variant v JOIN eligible e ON e.id=v.id
   ORDER BY v.id,(v.engaged::numeric/NULLIF(v.attempted,0)) DESC,v.attempted DESC,v.idx ASC
 )
 UPDATE public.campaigns c SET ab_winner=w.idx
 FROM winner w WHERE c.id=w.id AND c.ab_winner IS NULL;
END;
$$;

ALTER FUNCTION public.claim_campaign_messages(uuid,integer) RENAME TO claim_campaign_messages_before_ab_holdout;
CREATE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.decide_ab_winners();
  RETURN QUERY SELECT * FROM public.claim_campaign_messages_before_ab_holdout(_server,_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_ab_winners() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_ab_winners() TO service_role;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_campaign_messages_before_ab_holdout(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
