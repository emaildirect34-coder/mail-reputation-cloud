BEGIN;
ALTER TABLE public.campaigns
 ADD COLUMN ab_min_sample integer NOT NULL DEFAULT 100 CHECK (ab_min_sample BETWEEN 30 AND 1000),
 ADD COLUMN ab_decision_state text CHECK (ab_decision_state IS NULL OR ab_decision_state IN ('significant','inconclusive','insufficient_sample'));

CREATE FUNCTION public.ab_normal_cdf(_z double precision)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public AS $$
DECLARE x double precision; t double precision; erf_value double precision;
BEGIN
 x:=abs(_z)/sqrt(2.0); t:=1.0/(1.0+0.3275911*x);
 erf_value:=1.0-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*exp(-x*x);
 RETURN 0.5*(1.0+CASE WHEN _z<0 THEN -erf_value ELSE erf_value END);
END;
$$;
CREATE FUNCTION public.ab_proportion_p_value(_a bigint,_n_a bigint,_b bigint,_n_b bigint)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public AS $$
DECLARE pooled double precision; se double precision;
BEGIN
 IF _n_a<=0 OR _n_b<=0 OR _a<0 OR _b<0 OR _a>_n_a OR _b>_n_b THEN RETURN NULL; END IF;
 pooled:=(_a+_b)::double precision/(_n_a+_n_b)::double precision;
 se:=sqrt(pooled*(1-pooled)*(1.0::double precision/_n_a::double precision+1.0::double precision/_n_b::double precision));
 IF se=0 THEN RETURN CASE WHEN _a::numeric/_n_a=_b::numeric/_n_b THEN 1.0 ELSE 0.0 END; END IF;
 RETURN least(1.0,2.0*(1.0-public.ab_normal_cdf(abs(_a::double precision/_n_a-_b::double precision/_n_b)/se)));
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_ab_winners()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 WITH candidate AS (
  SELECT c.id,c.ab_min_sample,c.ab_metric,
   CASE WHEN jsonb_typeof(c.ab_variants)='array' THEN jsonb_array_length(c.ab_variants) ELSE 0 END AS variant_count
  FROM public.campaigns c WHERE c.ab_variants IS NOT NULL AND c.ab_winner IS NULL
   AND c.ab_decide_at IS NOT NULL AND c.ab_decide_at<=clock_timestamp()
   AND jsonb_typeof(c.ab_variants)='array' AND jsonb_array_length(c.ab_variants) BETWEEN 2 AND 3
 ), variant AS (
  SELECT c.id,c.ab_min_sample,c.variant_count,g.idx,
   count(m.id) FILTER(WHERE m.sent_at IS NOT NULL OR m.status='sent')::bigint AS attempted,
   count(m.id) FILTER(WHERE CASE c.ab_metric WHEN 'click' THEN m.clicked_at IS NOT NULL ELSE m.opened_at IS NOT NULL END)::bigint AS engaged
  FROM candidate c CROSS JOIN LATERAL generate_series(0,c.variant_count-1) g(idx)
  LEFT JOIN public.campaign_messages m ON m.campaign_id=c.id AND m.variant=g.idx
  GROUP BY c.id,c.ab_min_sample,c.variant_count,g.idx
 ), top_variant AS (
  SELECT DISTINCT ON(v.id) v.id,v.idx,v.attempted,v.engaged,v.ab_min_sample,v.variant_count
  FROM variant v WHERE v.attempted>0
  ORDER BY v.id,v.engaged::numeric/NULLIF(v.attempted,0) DESC,v.attempted DESC,v.idx ASC
 ), comparison AS (
  SELECT top.id,top.idx,top.ab_min_sample,top.variant_count,top.attempted AS top_attempted,
   bool_and(other.attempted>=top.ab_min_sample AND top.attempted>=top.ab_min_sample) AS enough,
   bool_and(top.engaged::numeric/NULLIF(top.attempted,0)>other.engaged::numeric/NULLIF(other.attempted,0)
    AND public.ab_proportion_p_value(top.engaged,top.attempted,other.engaged,other.attempted)<0.05::double precision/(top.variant_count-1)::double precision) AS significant
  FROM top_variant top JOIN variant other ON other.id=top.id AND other.idx<>top.idx
  GROUP BY top.id,top.idx,top.ab_min_sample,top.variant_count,top.attempted,top.engaged
 )
 UPDATE public.campaigns c SET
  ab_winner=CASE WHEN x.enough AND x.significant THEN x.idx ELSE 0 END,
  ab_decision_state=CASE WHEN x.enough AND x.significant THEN 'significant'
    WHEN EXISTS(SELECT 1 FROM variant v WHERE v.id=x.id AND v.attempted<x.ab_min_sample) THEN 'insufficient_sample'
    ELSE 'inconclusive' END
 FROM comparison x WHERE c.id=x.id AND c.ab_winner IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ab_normal_cdf(double precision),public.ab_proportion_p_value(bigint,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ab_normal_cdf(double precision),public.ab_proportion_p_value(bigint,bigint,bigint,bigint) TO service_role;

CREATE TABLE public.campaign_editorial_workflow (
 campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
 brief text NOT NULL DEFAULT '' CHECK (char_length(brief)<=5000),
 owner text NOT NULL DEFAULT '' CHECK (char_length(owner)<=160),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','review','approved')),
 due_on date,
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.campaign_editorial_workflow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_editorial_workflow FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.campaign_editorial_workflow TO service_role;

CREATE TABLE public.seed_placement_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 placement_id text NOT NULL UNIQUE,
 token text NOT NULL,
 status text NOT NULL CHECK (status IN ('waiting','done','expired','error')),
 seeds jsonb NOT NULL CHECK (jsonb_typeof(seeds)='array'),
 started_by uuid,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 checked_at timestamptz,
 completed_at timestamptz,
 expires_at timestamptz NOT NULL
);
CREATE INDEX seed_placement_runs_recent ON public.seed_placement_runs(started_at DESC);
ALTER TABLE public.seed_placement_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seed_placement_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.seed_placement_runs TO service_role;
COMMIT;
