BEGIN;

CREATE INDEX campaign_duplicate_body ON public.campaigns (md5(replace(html,chr(13)||chr(10),chr(10))))
 WHERE list_id IS NOT NULL;
CREATE INDEX campaign_duplicate_offer ON public.campaigns (sponsor_offer_id) WHERE list_id IS NOT NULL AND sponsor_offer_id IS NOT NULL;

CREATE TABLE public.campaign_duplicate_leases (
 key text PRIMARY KEY,
 token uuid NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX campaign_duplicate_lease_token ON public.campaign_duplicate_leases(token);
ALTER TABLE public.campaign_duplicate_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_duplicate_leases FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lease_campaign_duplicate_review(_body text,_offer uuid,_token uuid,_renew boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 keys text[] := ARRAY['body:'||_body] || CASE WHEN _offer IS NULL THEN '{}'::text[] ELSE ARRAY['offer:'||_offer::text] END;
 lease_key text;
 checked_at timestamptz;
BEGIN
 IF _body IS NULL OR _body !~ '^[a-f0-9]{32}$' OR _token IS NULL THEN RETURN false; END IF;
 FOR lease_key IN SELECT k FROM unnest(keys) k ORDER BY k LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(lease_key,63063));
 END LOOP;
 checked_at := clock_timestamp();
 IF EXISTS (SELECT 1 FROM public.campaign_duplicate_leases l WHERE l.key=ANY(keys) AND l.expires_at>checked_at AND l.token<>_token) THEN
  RETURN false;
 END IF;
 IF _renew AND (SELECT count(*) FROM public.campaign_duplicate_leases l
  WHERE l.key=ANY(keys) AND l.token=_token AND l.expires_at>checked_at)<>cardinality(keys) THEN
  RETURN false;
 END IF;
 INSERT INTO public.campaign_duplicate_leases(key,token,expires_at)
 SELECT k,_token,checked_at+interval '5 minutes' FROM unnest(keys) k
 ON CONFLICT (key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at;
 RETURN true;
END;
$$;

CREATE FUNCTION public.release_campaign_duplicate_review(_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 DELETE FROM public.campaign_duplicate_leases WHERE token=_token
$$;

CREATE FUNCTION public.find_campaign_duplicates(_body text,_offer uuid,_recipients text[],_as_of timestamptz)
RETURNS TABLE(overlap bigint,matches jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH candidates AS MATERIALIZED (
  SELECT c.id,c.name,c.status,c.created_at,c.scheduled_at,c.send_expires_at,c.auto_pause_reason,
   md5(replace(c.html,chr(13)||chr(10),chr(10)))=_body AS same_body,
   coalesce(c.sponsor_offer_id=_offer,false) AS same_offer
  FROM public.campaigns c
  WHERE c.list_id IS NOT NULL AND c.placement_probe_of IS NULL AND NOT c.purchase_thank_you
   AND (md5(replace(c.html,chr(13)||chr(10),chr(10)))=_body OR c.sponsor_offer_id=_offer)
 ), common AS MATERIALIZED (
  SELECT c.id,r.email_md5
  FROM unnest(_recipients) AS r(email_md5)
  JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=r.email_md5
  JOIN candidates c ON c.id=m.campaign_id
  WHERE c.status IN ('queued','paused') AND m.status IN ('queued','claimed') AND m.permit_granted_at IS NULL
   AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
   AND (c.send_expires_at IS NULL OR greatest(_as_of,c.scheduled_at,m.available_at)<c.send_expires_at)
  UNION
  SELECT c.id,r.email_md5
  FROM unnest(_recipients) AS r(email_md5)
  JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=r.email_md5
  JOIN candidates c ON c.id=m.campaign_id
  WHERE (m.sent_at IS NOT NULL OR m.permit_granted_at IS NOT NULL)
   AND greatest(m.sent_at,m.permit_granted_at)>=_as_of-interval '30 days'
   AND (m.status='sent' OR m.status='claimed' OR m.injection_uncertain_at IS NOT NULL)
 ), groups AS (
  SELECT c.id,c.name,c.status,c.created_at,c.scheduled_at,c.same_body,c.same_offer,
   count(*) AS overlap,md5(string_agg(d.email_md5,'' ORDER BY d.email_md5)) AS proof
  FROM common d JOIN candidates c ON c.id=d.id
  GROUP BY c.id,c.name,c.status,c.created_at,c.scheduled_at,c.same_body,c.same_offer
 )
 SELECT (SELECT count(DISTINCT email_md5) FROM common),
        coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM groups g),'[]'::jsonb)
$$;

REVOKE ALL ON FUNCTION public.lease_campaign_duplicate_review(text,uuid,uuid,boolean),
 public.release_campaign_duplicate_review(uuid),public.find_campaign_duplicates(text,uuid,text[],timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lease_campaign_duplicate_review(text,uuid,uuid,boolean),
 public.release_campaign_duplicate_review(uuid),public.find_campaign_duplicates(text,uuid,text[],timestamptz) TO service_role;
COMMIT;
