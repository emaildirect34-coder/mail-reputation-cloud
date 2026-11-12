BEGIN;

ALTER TABLE public.campaigns ADD COLUMN sponsor_monitor_tracking_url text;
CREATE FUNCTION public.snapshot_sponsor_monitor_url()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  SELECT o.tracking_url INTO NEW.sponsor_monitor_tracking_url FROM public.sponsor_offers o WHERE o.id=NEW.sponsor_offer_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER snapshot_sponsor_monitor_url BEFORE INSERT ON public.campaigns
  FOR EACH ROW WHEN (NEW.sponsor_offer_id IS NOT NULL) EXECUTE FUNCTION public.snapshot_sponsor_monitor_url();

CREATE TABLE public.sponsor_link_monitor (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT '-infinity',
  lease_id uuid,
  active_until timestamptz NOT NULL,
  result jsonb,
  baseline jsonb NOT NULL DEFAULT '{}',
  alert_since timestamptz
);
CREATE INDEX sponsor_link_monitor_due ON public.sponsor_link_monitor(next_check_at,campaign_id);
CREATE INDEX sponsor_campaigns_for_monitor ON public.campaigns(id) WHERE sponsor_offer_id IS NOT NULL AND list_id IS NOT NULL;
CREATE INDEX sponsor_message_last_send ON public.campaign_messages(campaign_id,sent_at DESC) WHERE sent_at IS NOT NULL;
ALTER TABLE public.sponsor_link_monitor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_link_monitor FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sponsor_link_monitor TO service_role;

CREATE FUNCTION public.claim_sponsor_link_checks()
RETURNS TABLE(campaign_id uuid,lease_id uuid,html text,tracking_url text,offer_status text,baseline jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(69001) THEN RETURN; END IF;
  INSERT INTO public.sponsor_link_monitor(campaign_id,active_until)
  SELECT c.id,latest.sent_at+interval '30 days'
  FROM public.campaigns c LEFT JOIN public.sponsor_link_monitor s ON s.campaign_id=c.id
  CROSS JOIN LATERAL (
    SELECT m.sent_at FROM public.campaign_messages m
    WHERE m.campaign_id=c.id AND m.sent_at>=now()-interval '30 days'
      AND (s.active_until IS NULL OR m.sent_at>s.active_until-interval '30 days')
    ORDER BY m.sent_at DESC LIMIT 1
  ) latest
  WHERE c.sponsor_offer_id IS NOT NULL AND c.list_id IS NOT NULL
  ORDER BY c.id LIMIT 100
  ON CONFLICT ON CONSTRAINT sponsor_link_monitor_pkey DO UPDATE SET active_until=excluded.active_until;

  RETURN QUERY
  WITH leased AS (
    UPDATE public.sponsor_link_monitor s SET lease_id=gen_random_uuid(),next_check_at=now()+interval '10 minutes'
    WHERE s.campaign_id IN (
      SELECT m.campaign_id FROM public.sponsor_link_monitor m
      JOIN public.campaigns c ON c.id=m.campaign_id
      WHERE m.active_until>now() AND m.next_check_at<=now() AND c.sponsor_offer_id IS NOT NULL
      ORDER BY m.next_check_at,m.campaign_id LIMIT 4 FOR UPDATE OF m SKIP LOCKED
    )
    RETURNING s.*
  )
  SELECT l.campaign_id,l.lease_id,c.html,coalesce(c.sponsor_monitor_tracking_url,o.tracking_url),o.status,l.baseline
  FROM leased l JOIN public.campaigns c ON c.id=l.campaign_id
  JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id;
END;
$$;

CREATE FUNCTION public.finish_sponsor_link_check(_campaign uuid,_lease uuid,_result jsonb,_baseline jsonb,_alert boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.sponsor_link_monitor s SET checked_at=now(),next_check_at=now()+interval '6 hours',lease_id=NULL,
    result=_result,baseline=_baseline,alert_since=CASE WHEN _alert THEN coalesce(s.alert_since,now()) ELSE NULL END
  WHERE s.campaign_id=_campaign AND s.lease_id=_lease AND s.next_check_at>now();
  RETURN FOUND;
END;
$$;

CREATE TABLE public.sponsor_conversion_reports (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  date_from date NOT NULL,
  date_to date NOT NULL CHECK (date_to-date_from BETWEEN 0 AND 30),
  transaction_ids text[] NOT NULL CHECK (cardinality(transaction_ids)<=5000),
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid NOT NULL,
  PRIMARY KEY (campaign_id,date_from,date_to)
);
ALTER TABLE public.sponsor_conversion_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_conversion_reports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.sponsor_conversion_reports TO service_role;
CREATE INDEX sponsor_finance_postbacks_by_campaign ON public.finance_entries(campaign_id,occurred_on)
  WHERE source='api' AND kind='revenue';

CREATE FUNCTION public.read_sponsor_conversion_reconciliation(_campaign uuid,_from date,_to date,_offset integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH report AS MATERIALIZED (
   SELECT r.imported_at,r.transaction_ids,c.sponsor_offer_id,o.account_id
   FROM public.sponsor_conversion_reports r JOIN public.campaigns c ON c.id=r.campaign_id
   JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id
   WHERE r.campaign_id=_campaign AND r.date_from=_from AND r.date_to=_to
 ), classified AS MATERIALIZED (
   SELECT tx.id AS transaction_id,CASE
     WHEN f.id IS NULL THEN 'missing'
     WHEN f.campaign_id IS DISTINCT FROM _campaign OR f.offer_id IS DISTINCT FROM r.sponsor_offer_id THEN 'attribution'
     WHEN p.finance_id IS NULL THEN 'unverified'
     WHEN p.status<>'approved' THEN 'status'
     ELSE 'matched' END AS reason,coalesce(p.status,f.status) AS local_status
   FROM report r CROSS JOIN LATERAL unnest(r.transaction_ids) tx(id)
   LEFT JOIN public.finance_entries f ON f.account_id=r.account_id AND f.external_id='pb:'||tx.id AND f.source='api' AND f.kind='revenue'
   LEFT JOIN public.sponsor_purchases p ON p.finance_id=f.id
   UNION ALL
   SELECT substr(f.external_id,4),'local_only',p.status
   FROM report r JOIN public.finance_entries f ON f.campaign_id=_campaign AND f.offer_id=r.sponsor_offer_id AND f.account_id=r.account_id
     AND f.source='api' AND f.kind='revenue' AND f.occurred_on BETWEEN _from AND _to
   JOIN public.sponsor_purchases p ON p.finance_id=f.id AND p.status='approved'
   WHERE left(f.external_id,3)='pb:' AND NOT substr(f.external_id,4)=ANY(r.transaction_ids)
 ), counts AS (
   SELECT count(*) FILTER (WHERE reason='matched') AS matched,
     count(*) FILTER (WHERE reason='missing') AS missing,
     count(*) FILTER (WHERE reason='attribution') AS attribution,
     count(*) FILTER (WHERE reason='unverified') AS unverified,
     count(*) FILTER (WHERE reason='status') AS status,
     count(*) FILTER (WHERE reason='local_only') AS local_only
   FROM classified
 )
 SELECT jsonb_build_object('importedAt',r.imported_at,'reported',cardinality(r.transaction_ids),'counts',to_jsonb(n),
   'issues',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.reason,i.transaction_id) FROM (
     SELECT transaction_id,reason,local_status FROM classified WHERE reason<>'matched'
     ORDER BY reason,transaction_id LIMIT 50 OFFSET greatest(0,_offset)
   ) i),'[]'::jsonb))
 FROM report r CROSS JOIN counts n
$$;

REVOKE ALL ON FUNCTION public.claim_sponsor_link_checks(), public.finish_sponsor_link_check(uuid,uuid,jsonb,jsonb,boolean),
 public.read_sponsor_conversion_reconciliation(uuid,date,date,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.snapshot_sponsor_monitor_url() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_sponsor_link_checks(), public.finish_sponsor_link_check(uuid,uuid,jsonb,jsonb,boolean),
 public.read_sponsor_conversion_reconciliation(uuid,date,date,integer) TO service_role;
COMMIT;
