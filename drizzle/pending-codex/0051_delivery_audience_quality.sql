BEGIN;

CREATE INDEX subscription_confirmations_recent_contact
  ON public.subscription_confirmations(email_md5,confirmed_at DESC);
CREATE INDEX campaign_messages_recent_injection_server
  ON public.campaign_messages(server_id,greatest(sent_at,permit_granted_at),campaign_id)
  WHERE sent_at IS NOT NULL OR permit_granted_at IS NOT NULL;

CREATE FUNCTION public.has_recent_delivery_engagement(_email text,_days integer)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscription_confirmations s
    WHERE s.email_md5=md5(lower(btrim(_email))) AND s.confirmed_at >= now()-make_interval(days=>_days)
  ) OR EXISTS (
    SELECT 1 FROM public.campaign_messages m
    WHERE lower(btrim(m.email))=lower(btrim(_email)) AND m.verified_click_id IS NOT NULL
      AND m.clicked_at >= now()-make_interval(days=>_days)
  )
$$;

CREATE OR REPLACE FUNCTION public.campaign_sunset_contacts(_ids uuid[],_days integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id FROM public.contacts c WHERE c.id=ANY(_ids) AND _days IN (30,60,90,365)
   AND NOT public.has_recent_delivery_engagement(c.email,_days)
   AND EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE lower(btrim(m.email))=lower(btrim(c.email))
     AND m.contact_id IS NOT NULL AND m.delivery_state='delivered' AND m.sent_at < now()-make_interval(days=>_days)
   )
$$;

CREATE OR REPLACE FUNCTION public.campaign_sunset_contacts_by_isp(_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id FROM public.contacts c CROSS JOIN LATERAL (
   SELECT CASE public.campaign_recipient_provider(lower(split_part(c.email,'@',2)))
     WHEN 'Gmail' THEN 30 WHEN 'Yahoo' THEN 30 WHEN 'Orange' THEN 60 WHEN 'Free' THEN 60 WHEN 'SFR' THEN 60 ELSE 90 END AS days
 ) cohort
 WHERE c.id=ANY(_ids) AND NOT public.has_recent_delivery_engagement(c.email,cohort.days)
   AND EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE lower(btrim(m.email))=lower(btrim(c.email))
     AND m.contact_id IS NOT NULL AND m.delivery_state='delivered' AND m.sent_at < now()-make_interval(days=>cohort.days)
   )
$$;

CREATE FUNCTION public.stage_released_campaign_provider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  base_time timestamptz;
BEGIN
  SELECT greatest(now(),scheduled_at) INTO base_time FROM public.campaigns WHERE id=NEW.campaign_id;
  WITH ranked AS (
    SELECT m.id, row_number() OVER (
      ORDER BY public.has_recent_delivery_engagement(m.email,30) DESC,m.created_at,m.id
    ) AS position, count(*) OVER () AS size
    FROM public.campaign_messages m WHERE m.campaign_id=NEW.campaign_id AND m.status='queued'
      AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=NEW.provider
  )
  UPDATE public.campaign_messages m SET available_at=greatest(m.available_at,base_time+
    CASE WHEN ranked.position<=greatest(1,least(25,ceil(ranked.size*0.1))) THEN interval '0 minutes'
         WHEN ranked.position<=greatest(2,ceil(ranked.size*0.5)) THEN interval '20 minutes'
         ELSE interval '40 minutes' END)
  FROM ranked WHERE m.id=ranked.id AND m.status='queued';
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage_released_campaign_provider AFTER INSERT ON public.campaign_placement_releases
FOR EACH ROW EXECUTE FUNCTION public.stage_released_campaign_provider();

CREATE FUNCTION public.read_sponsor_delivery_quality(_offer uuid)
RETURNS TABLE(source text, accepted bigint, hard_bounces bigint, complaints bigint, unsubscribes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH recent AS (
    SELECT e.message_id,e.campaign_id,
      bool_or(e.event_type='delivered') AS accepted,
      bool_or(e.event_type='bounce' AND public.provider_smtp_policy(e.isp,e.smtp_code,e.detail) IS NULL) AS bounced,
      bool_or(e.event_type='complaint') AS complained
    FROM public.delivery_events e JOIN public.campaigns c ON c.id=e.campaign_id
    WHERE (c.sponsor_offer_id=_offer OR (_offer IS NULL AND c.list_id IS NOT NULL))
      AND e.occurred_at>=now()-interval '7 days'
    GROUP BY e.message_id,e.campaign_id
  ), totals AS (
    SELECT c.list_id, count(*) FILTER (WHERE r.accepted) AS accepted,
      count(*) FILTER (WHERE r.bounced) AS bounced,count(*) FILTER (WHERE r.complained) AS complained, 0::bigint AS unsubscribed
    FROM recent r JOIN public.campaigns c ON c.id=r.campaign_id GROUP BY c.list_id
    UNION ALL
    SELECT c.list_id,0,0,0,count(*)
    FROM public.suppressions s JOIN public.campaigns c ON s.source='campagne '||c.id::text
    WHERE (c.sponsor_offer_id=_offer OR (_offer IS NULL AND c.list_id IS NOT NULL))
      AND s.reason='unsubscribe' AND s.created_at>=now()-interval '7 days'
    GROUP BY c.list_id
  )
  SELECT coalesce(l.name,'Liste inconnue'),sum(t.accepted)::bigint,sum(t.bounced)::bigint,
    sum(t.complained)::bigint,sum(t.unsubscribed)::bigint
  FROM totals t LEFT JOIN public.contact_lists l ON l.id=t.list_id
  GROUP BY l.id,l.name ORDER BY sum(t.accepted) DESC
$$;

CREATE FUNCTION public.agent_provider_holds(_server uuid)
RETURNS TABLE(campaign uuid, domain text, until_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT DISTINCT c.id,lower(split_part(m.email,'@',2)),h.until_at
  FROM public.delivery_provider_holds h
  JOIN public.campaigns c ON lower(split_part(c.from_email,'@',2))=h.sender_domain
  JOIN public.campaign_messages m ON m.campaign_id=c.id AND m.server_id=_server
  WHERE (h.until_at IS NULL OR h.until_at>now())
    AND NOT (c.placement_probe_token IS NOT NULL AND h.reason='outlook_auth')
    AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=h.provider
    AND (m.sent_at IS NOT NULL OR m.permit_granted_at IS NOT NULL)
    AND greatest(m.sent_at,m.permit_granted_at)>now()-interval '14 days'
  UNION
  SELECT DISTINCT c.id,lower(split_part(m.email,'@',2)),NULL::timestamptz
  FROM public.sponsor_offers o JOIN public.campaigns c ON c.sponsor_offer_id=o.id
  JOIN public.campaign_messages m ON m.campaign_id=c.id AND m.server_id=_server
  WHERE (o.status<>'active' OR o.delivery_paused) AND (m.sent_at IS NOT NULL OR m.permit_granted_at IS NOT NULL)
    AND greatest(m.sent_at,m.permit_granted_at)>now()-interval '14 days'
$$;

REVOKE ALL ON FUNCTION public.has_recent_delivery_engagement(text,integer),
  public.stage_released_campaign_provider(),public.read_sponsor_delivery_quality(uuid),public.agent_provider_holds(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sponsor_delivery_quality(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_provider_holds(uuid) TO service_role;
COMMIT;
