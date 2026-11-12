BEGIN;

CREATE INDEX contact_message_history ON public.campaign_messages(md5(lower(btrim(email))),sent_at DESC)
  WHERE sent_at IS NOT NULL;
CREATE INDEX sponsor_purchase_message_lookup ON public.sponsor_purchases(source_message_id);

CREATE TABLE public.campaign_unsubscribe_reasons (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_hash text NOT NULL CHECK (recipient_hash ~ '^[a-f0-9]{32}$'),
  reason text NOT NULL CHECK (reason IN ('too_many','irrelevant','not_requested','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,recipient_hash)
);
CREATE INDEX campaign_unsubscribe_reasons_recent ON public.campaign_unsubscribe_reasons(created_at DESC);
ALTER TABLE public.campaign_unsubscribe_reasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_unsubscribe_reasons FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_campaign_unsubscribe_reason(_token text,_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.campaign_unsubscribe_reasons(campaign_id,recipient_hash,reason)
  SELECT m.campaign_id,s.email_md5,_reason FROM public.campaign_messages m
  JOIN public.suppressions s ON s.email_md5=md5(lower(btrim(m.email))) AND s.reason='unsubscribe'
    AND s.source='campagne '||m.campaign_id::text
  WHERE m.unsub_token=_token AND s.created_at>=now()-interval '30 days' AND m.email NOT LIKE 'email-direct-unsub-%@example.invalid'
  ON CONFLICT (campaign_id,recipient_hash) DO UPDATE SET reason=excluded.reason;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.read_campaign_unsubscribe_reasons()
RETURNS TABLE(reason text,total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT r.reason,count(*) FROM public.campaign_unsubscribe_reasons r
  WHERE r.created_at>=now()-interval '30 days' GROUP BY r.reason ORDER BY count(*) DESC,r.reason
$$;

CREATE TABLE public.sponsor_purchase_reviews (
  finance_id uuid PRIMARY KEY REFERENCES public.sponsor_purchases(finance_id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(comment)<=500),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sponsor_purchase_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_purchase_reviews FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_sponsor_purchase_review(_hash text,_rating integer,_comment text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _rating NOT BETWEEN 1 AND 5 OR _comment IS NULL OR char_length(_comment)>500 THEN RETURN false; END IF;
  INSERT INTO public.sponsor_purchase_reviews(finance_id,rating,comment)
  SELECT p.finance_id,_rating,btrim(_comment) FROM public.sponsor_purchases p
  WHERE p.feedback_hash=_hash AND p.status='approved' AND p.approved_at>now()-interval '180 days'
  ON CONFLICT (finance_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,submitted_at=now();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.read_sponsor_purchase_reviews(_offer uuid)
RETURNS TABLE(total bigint, average_rating double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT count(*),avg(r.rating)::double precision FROM public.sponsor_purchases p
  JOIN public.sponsor_purchase_reviews r ON r.finance_id=p.finance_id
  WHERE p.offer_id=_offer AND p.status='approved' AND p.approved_at>=now()-interval '90 days'
$$;

CREATE FUNCTION public.read_contact_history(_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH target AS (SELECT md5(lower(btrim(_email))) AS hash), events AS (
  SELECT c.created_at AS at,'list' AS kind,l.name AS label,c.status AS detail
  FROM target JOIN public.contacts c ON c.email_md5=target.hash JOIN public.contact_lists l ON l.id=c.list_id
  UNION ALL
  SELECT p.confirmed_at,'consent',l.name,NULL
  FROM target JOIN public.subscription_confirmations p ON p.email_md5=target.hash JOIN public.contact_lists l ON l.id=p.list_id
  UNION ALL
  SELECT s.created_at,'suppression',s.reason,NULL
  FROM target JOIN public.suppressions s ON s.email_md5=target.hash
  UNION ALL
  SELECT m.sent_at,'send',c.name,m.delivery_state FROM target
  CROSS JOIN LATERAL (
    SELECT j.campaign_id,j.sent_at,j.delivery_state FROM public.campaign_messages j
    WHERE md5(lower(btrim(j.email)))=target.hash AND j.sent_at IS NOT NULL ORDER BY j.sent_at DESC LIMIT 25
  ) m JOIN public.campaigns c ON c.id=m.campaign_id
  UNION ALL
  SELECT p.approved_at,'purchase',o.name,NULL
  FROM target JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=target.hash
  JOIN public.sponsor_purchases p ON p.source_message_id=m.id AND p.status='approved' AND p.approved_at IS NOT NULL
  JOIN public.sponsor_offers o ON o.id=p.offer_id
  UNION ALL
  SELECT p.consent_at,'purchase_consent',o.name,NULL
  FROM target JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=target.hash
  JOIN public.sponsor_purchases p ON p.source_message_id=m.id AND p.consent_at IS NOT NULL
  JOIN public.sponsor_offers o ON o.id=p.offer_id
 ), limited AS (
   SELECT * FROM events ORDER BY at DESC,kind,label LIMIT 50
 )
 SELECT jsonb_build_object(
   'events',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.at DESC,l.kind,l.label) FROM limited l),'[]'),
   'topics', (SELECT p.topics FROM public.recipient_topic_preferences p WHERE p.email_md5=target.hash),
   'weekly', EXISTS(SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5=target.hash),
   'digest', EXISTS(SELECT 1 FROM public.recipient_digest_preferences p WHERE p.email_md5=target.hash)
 ) FROM target
$$;

CREATE FUNCTION public.read_offer_contact_cohorts(_offer uuid)
RETURNS TABLE(month date, accepted bigint, purchases bigint, unsubscribed bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH sent AS MATERIALIZED (
   SELECT m.id,m.campaign_id,md5(lower(btrim(m.email))) AS hash,
     date_trunc('month',ct.created_at AT TIME ZONE 'UTC')::date AS month,
     m.delivery_state='delivered' OR EXISTS (SELECT 1 FROM public.delivery_events e
       WHERE e.message_id=m.id AND e.campaign_id=m.campaign_id AND e.event_type='delivered') AS accepted
   FROM public.campaigns c JOIN public.campaign_messages m ON m.campaign_id=c.id
   LEFT JOIN public.contacts ct ON ct.id=m.contact_id
   WHERE c.sponsor_offer_id=_offer AND m.sent_at>=now()-interval '90 days' AND c.list_id IS NOT NULL
 ), by_month AS (
   SELECT s.month,count(*) FILTER (WHERE s.accepted) AS accepted,0::bigint AS purchases,0::bigint AS unsubscribed
   FROM sent s GROUP BY s.month
   UNION ALL
   SELECT s.month,0,count(*),0 FROM sent s JOIN public.sponsor_purchases p ON p.source_message_id=s.id
   WHERE p.offer_id=_offer AND p.status='approved' GROUP BY s.month
   UNION ALL
   SELECT s.month,0,0,count(DISTINCT sup.email_md5)
   FROM sent s JOIN public.suppressions sup ON sup.email_md5=s.hash AND sup.reason='unsubscribe'
    AND sup.source='campagne '||s.campaign_id::text GROUP BY s.month
 )
 SELECT b.month,sum(b.accepted)::bigint,sum(b.purchases)::bigint,sum(b.unsubscribed)::bigint
 FROM by_month b GROUP BY b.month ORDER BY b.month DESC NULLS LAST
$$;

CREATE FUNCTION public.read_contact_list_insights(_list uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH purchase_consent AS MATERIALIZED (
   SELECT md5(lower(btrim(m.email))) AS hash,min(p.consent_at) AS at
   FROM public.sponsor_purchases p JOIN public.campaign_messages m ON m.id=p.source_message_id
   WHERE p.consent_list_id=_list AND p.consent_at IS NOT NULL GROUP BY 1
 ), active AS (
   SELECT count(*) AS active,
     count(*) FILTER (WHERE t.email_md5 IS NULL) AS no_topics,
     count(*) FILTER (WHERE w.email_md5 IS NULL) AS no_weekly_preference
   FROM public.contacts c
   LEFT JOIN public.recipient_topic_preferences t ON t.email_md5=c.email_md5
   LEFT JOIN public.recipient_weekly_preferences w ON w.email_md5=c.email_md5
   LEFT JOIN public.suppressions s ON s.email_md5=c.email_md5
   WHERE c.list_id=_list AND c.status='active' AND s.email_md5 IS NULL
 ), messages AS MATERIALIZED (
   SELECT m.id,m.campaign_id,md5(lower(btrim(m.email))) AS hash,c.topic,m.delivery_state,m.sent_at
   FROM public.campaigns c JOIN public.campaign_messages m ON m.campaign_id=c.id
   WHERE c.list_id=_list AND m.sent_at>=now()-interval '30 days'
 ), quality AS (
   SELECT CASE WHEN doi.at IS NOT NULL AND (pc.at IS NULL OR doi.at<=pc.at) THEN 'confirmation'
     WHEN pc.at IS NOT NULL THEN 'after_purchase' ELSE 'unknown' END AS source,
     count(*) FILTER (WHERE m.delivery_state='delivered') AS accepted,
     count(*) FILTER (WHERE m.delivery_state='bounced') AS bounced,
     count(*) FILTER (WHERE m.delivery_state='complained') AS complained,
     sum((SELECT count(*) FROM public.sponsor_purchases p WHERE p.source_message_id=m.id AND p.status='approved'))::bigint AS purchases
   FROM messages m LEFT JOIN purchase_consent pc ON pc.hash=m.hash AND pc.at<=m.sent_at
   LEFT JOIN LATERAL (
     SELECT min(x.confirmed_at) AS at FROM public.subscription_confirmations x
     WHERE x.list_id=_list AND x.email_md5=m.hash AND x.confirmed_at<=m.sent_at
   ) doi ON true
   GROUP BY 1
 ), by_topic AS (
   SELECT m.topic,m.hash,count(*) AS sent FROM messages m WHERE m.topic IS NOT NULL GROUP BY m.topic,m.hash
 ), saturation AS (
   SELECT t.topic,count(*) AS recipients,sum(t.sent)::bigint AS sent,max(t.sent) AS peak,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY t.sent) AS median
   FROM by_topic t GROUP BY t.topic
 )
 SELECT jsonb_build_object('preferences',to_jsonb(active),
   'quality',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.source) FROM quality q),'[]'),
   'saturation',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.topic) FROM saturation s),'[]'))
 FROM active
$$;

REVOKE ALL ON FUNCTION public.read_contact_history(text),public.read_offer_contact_cohorts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contact_history(text),public.read_offer_contact_cohorts(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.read_contact_list_insights(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contact_list_insights(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_campaign_unsubscribe_reason(text,text),public.read_campaign_unsubscribe_reasons(),
 public.record_sponsor_purchase_review(text,integer,text),public.read_sponsor_purchase_reviews(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_campaign_unsubscribe_reason(text,text),public.read_campaign_unsubscribe_reasons(),
 public.record_sponsor_purchase_review(text,integer,text),public.read_sponsor_purchase_reviews(uuid) TO service_role;
COMMIT;
