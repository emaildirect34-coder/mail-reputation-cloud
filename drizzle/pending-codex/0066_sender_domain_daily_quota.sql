BEGIN;

CREATE TABLE public.sender_domain_quotas (
 domain text PRIMARY KEY,
 daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 100000000)
);
CREATE TABLE public.sender_domain_daily_usage (
 domain text NOT NULL,
 utc_day date NOT NULL,
 used bigint NOT NULL CHECK (used>0),
 PRIMARY KEY (domain,utc_day)
);
ALTER TABLE public.sender_domain_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_domain_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sender_domain_quotas,public.sender_domain_daily_usage FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.campaign_sender_quota_domain(_campaign public.campaigns)
RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN _campaign.placement_probe_of IS NULL AND (_campaign.list_id IS NOT NULL OR _campaign.purchase_thank_you
  OR EXISTS (SELECT 1 FROM public.campaign_versions v WHERE v.campaign_id=_campaign.id))
  THEN nullif(lower(btrim(split_part(_campaign.from_email,'@',2))),'') END
$$;

-- Include authorizations already recorded today so enabling a quota mid-day retains the observed usage.
LOCK TABLE public.campaign_messages IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.sender_domain_daily_usage(domain,utc_day,used)
 SELECT d.domain,today.utc_day,count(*)
 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
 CROSS JOIN LATERAL (SELECT public.campaign_sender_quota_domain(c) AS domain) d
 CROSS JOIN (SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date AS utc_day) today
 WHERE d.domain IS NOT NULL
  AND coalesce(m.permit_granted_at,m.sent_at)>=(today.utc_day::timestamp AT TIME ZONE 'UTC')
  AND coalesce(m.permit_granted_at,m.sent_at)<((today.utc_day+1)::timestamp AT TIME ZONE 'UTC')
 GROUP BY d.domain,today.utc_day;

CREATE FUNCTION public.sender_domain_quota_available(_domain text,_day date)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM public.sender_domain_quotas q JOIN public.sender_domain_daily_usage u
   ON u.domain=q.domain AND u.utc_day=_day
  WHERE q.domain=_domain AND u.used>=q.daily_limit
 )
$$;

CREATE FUNCTION public.set_sender_domain_quota(_domain text,_daily_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE domain_name text := lower(btrim(_domain));
BEGIN
 IF domain_name IS NULL OR char_length(domain_name)>253
  OR domain_name !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  OR (_daily_limit IS NOT NULL AND _daily_limit NOT BETWEEN 1 AND 100000000) THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(domain_name,66066));
 IF _daily_limit IS NULL THEN
  DELETE FROM public.sender_domain_quotas WHERE domain=domain_name;
 ELSE
  INSERT INTO public.sender_domain_quotas(domain,daily_limit) VALUES (domain_name,_daily_limit)
  ON CONFLICT (domain) DO UPDATE SET daily_limit=excluded.daily_limit;
 END IF;
 RETURN true;
END;
$$;

CREATE FUNCTION public.read_sender_domain_quota(_domain text)
RETURNS TABLE(domain text,daily_limit integer,used bigint,reset_at timestamptz,exhausted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT d.domain,q.daily_limit,coalesce(u.used,0),((d.utc_day+1)::timestamp AT TIME ZONE 'UTC'),
  coalesce(u.used>=q.daily_limit,false)
 FROM (SELECT lower(btrim(_domain)) AS domain,(statement_timestamp() AT TIME ZONE 'UTC')::date AS utc_day) d
 LEFT JOIN public.sender_domain_quotas q ON q.domain=d.domain
 LEFT JOIN public.sender_domain_daily_usage u ON u.domain=d.domain AND u.utc_day=d.utc_day
 WHERE d.domain IS NOT NULL AND d.domain<>''
$$;

CREATE FUNCTION public.read_campaign_sender_domain_quota(_campaign uuid)
RETURNS TABLE(domain text,daily_limit integer,used bigint,reset_at timestamptz,exhausted boolean,waiting boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT q.*,q.exhausted AND c.status='queued' AND c.auto_pause_reason IS NULL
  AND (NOT c.approval_required OR c.approved_revision=c.review_revision)
  AND (c.scheduled_at IS NULL OR c.scheduled_at<=statement_timestamp())
  AND (c.send_expires_at IS NULL OR c.send_expires_at>statement_timestamp())
  AND EXISTS (SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.status='queued'
   AND (m.available_at IS NULL OR m.available_at<=statement_timestamp()))
 FROM public.campaigns c
 CROSS JOIN LATERAL public.read_sender_domain_quota(public.campaign_sender_quota_domain(c)) q
 WHERE c.id=_campaign
$$;

ALTER FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages) RENAME TO campaign_job_ready_before_domain_quota;
CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql SET search_path=public AS $$
 SELECT public.campaign_job_ready_before_domain_quota(_campaign,_message)
 AND public.sender_domain_quota_available(public.campaign_sender_quota_domain(_campaign),(clock_timestamp() AT TIME ZONE 'UTC')::date)
 AND (NOT EXISTS (SELECT 1 FROM public.sender_domain_quotas q WHERE q.domain=public.campaign_sender_quota_domain(_campaign))
  OR EXISTS (SELECT 1 FROM public.server_agents a WHERE a.server_id=_message.server_id AND a.metrics->>'preferencePermit'='true'))
$$;

ALTER FUNCTION public.agent_may_inject_approved(uuid,uuid,uuid) RENAME TO agent_may_inject_before_domain_quota;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_domain_quota(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject_approved(_server uuid,_id uuid,_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 job public.campaign_messages;
 campaign public.campaigns;
 domain_name text;
 checked_at timestamptz;
 utc_day date;
 quota_limit integer;
BEGIN
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(md5(lower(btrim(job.email))),29029));
 SELECT * INTO campaign FROM public.campaigns WHERE id=job.campaign_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed' AND campaign_id=campaign.id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 domain_name := public.campaign_sender_quota_domain(campaign);
 IF domain_name IS NULL THEN RETURN public.agent_may_inject_before_domain_quota(_server,_id,_revision); END IF;
 -- A permit is counted once. An acknowledgement can still arrive after the agent loses its response.
 IF job.permit_granted_at IS NOT NULL THEN RETURN false; END IF;
 IF NOT public.agent_may_inject_before_domain_quota(_server,_id,_revision) THEN RETURN false; END IF;

 -- Hold the shared domain lock only while issuing the final permit and updating the daily counter.
 PERFORM pg_advisory_xact_lock(hashtextextended(domain_name,66066));
 checked_at := clock_timestamp();
 utc_day := (checked_at AT TIME ZONE 'UTC')::date;
 IF campaign.send_expires_at IS NOT NULL AND campaign.send_expires_at<=checked_at THEN
  UPDATE public.campaign_messages SET status='expired',expired_at=campaign.send_expires_at,
   error='Date limite de campagne atteinte',permit_granted_at=NULL WHERE id=_id;
  PERFORM public.close_expired_campaign(campaign.id);
  RETURN false;
 END IF;
 SELECT q.daily_limit INTO quota_limit FROM public.sender_domain_quotas q WHERE q.domain=domain_name;
 INSERT INTO public.sender_domain_daily_usage AS u(domain,utc_day,used) VALUES (domain_name,utc_day,1)
 ON CONFLICT ON CONSTRAINT sender_domain_daily_usage_pkey DO UPDATE SET used=u.used+1
 WHERE quota_limit IS NULL OR u.used<quota_limit;
 IF NOT FOUND THEN
  UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,claimed_revision=NULL,permit_granted_at=NULL WHERE id=_id;
  RETURN false;
 END IF;
 UPDATE public.campaign_messages SET permit_granted_at=checked_at WHERE id=_id;
 RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_sender_quota_domain(public.campaigns),public.sender_domain_quota_available(text,date),
 public.campaign_job_ready(public.campaigns,public.campaign_messages) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_sender_domain_quota(text,integer),public.read_sender_domain_quota(text),public.read_campaign_sender_domain_quota(uuid),
 public.agent_may_inject_approved(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_sender_domain_quota(text,integer),public.read_sender_domain_quota(text),public.read_campaign_sender_domain_quota(uuid),
 public.agent_may_inject_approved(uuid,uuid,uuid) TO service_role;
COMMIT;
