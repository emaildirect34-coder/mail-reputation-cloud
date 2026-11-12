BEGIN;
-- These existing editor fields may already be present in the Lovable database.
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS ab_variants jsonb,
 ADD COLUMN IF NOT EXISTS ab_metric text, ADD COLUMN IF NOT EXISTS ab_decide_at timestamptz,
 ADD COLUMN IF NOT EXISTS ab_winner smallint;
ALTER TABLE public.campaigns
 ADD COLUMN approval_required boolean NOT NULL DEFAULT false,
 ADD COLUMN review_revision uuid,
 ADD COLUMN approved_revision uuid,
 ADD COLUMN approved_at timestamptz,
 ADD COLUMN approval_changes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.campaign_messages ADD COLUMN claimed_revision uuid;

-- Existing scheduled sends get a first review before further injection.
UPDATE public.campaigns SET approval_required=true,review_revision=gen_random_uuid(),approval_changes=ARRAY['initial']
WHERE scheduled_at IS NOT NULL AND status IN ('queued','paused');

CREATE FUNCTION public.track_scheduled_campaign_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE changed text[] := '{}';
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.scheduled_at IS NOT NULL THEN
   NEW.approval_required := true;
   NEW.review_revision := gen_random_uuid();
   IF NEW.status='paused' AND NEW.auto_pause_reason='Préparation des destinataires en cours' THEN
    NEW.approved_revision := NEW.review_revision;
    NEW.approved_at := clock_timestamp();
   ELSE
    NEW.approval_changes := ARRAY['initial'];
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NOT OLD.approval_required THEN
  IF NEW.scheduled_at IS NOT NULL THEN
   NEW.approval_required := true;
   NEW.review_revision := gen_random_uuid();
   NEW.approval_changes := ARRAY['initial'];
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.subject IS DISTINCT FROM OLD.subject THEN changed := array_append(changed,'subject'); END IF;
 IF NEW.html IS DISTINCT FROM OLD.html THEN changed := array_append(changed,'html'); END IF;
 IF NEW.amp_html IS DISTINCT FROM OLD.amp_html THEN changed := array_append(changed,'amp'); END IF;
 IF ROW(NEW.from_name,NEW.from_email,NEW.reply_to) IS DISTINCT FROM ROW(OLD.from_name,OLD.from_email,OLD.reply_to) THEN changed := array_append(changed,'sender'); END IF;
 IF ROW(NEW.sponsor_offer_id,NEW.sponsor_brand_id) IS DISTINCT FROM ROW(OLD.sponsor_offer_id,OLD.sponsor_brand_id) THEN changed := array_append(changed,'sponsor'); END IF;
 IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN changed := array_append(changed,'list'); END IF;
 IF ROW(NEW.server_ids,NEW.vmta_pool_id) IS DISTINCT FROM ROW(OLD.server_ids,OLD.vmta_pool_id) THEN changed := array_append(changed,'server'); END IF;
 IF ROW(NEW.scheduled_at,NEW.send_window_start,NEW.send_window_end) IS DISTINCT FROM ROW(OLD.scheduled_at,OLD.send_window_start,OLD.send_window_end) THEN changed := array_append(changed,'schedule'); END IF;
 IF ROW(NEW.ab_variants,NEW.ab_metric) IS DISTINCT FROM ROW(OLD.ab_variants,OLD.ab_metric) THEN changed := array_append(changed,'variants'); END IF;
 IF ROW(NEW.topic,NEW.requires_placement,NEW.weekly_digest,NEW.fatigue_protection) IS DISTINCT FROM ROW(OLD.topic,OLD.requires_placement,OLD.weekly_digest,OLD.fatigue_protection) THEN changed := array_append(changed,'rules'); END IF;
 IF cardinality(changed)>0 THEN
  NEW.review_revision := gen_random_uuid();
  NEW.approval_changes := ARRAY(SELECT DISTINCT field FROM unnest(OLD.approval_changes||changed) field ORDER BY field);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER scheduled_campaign_changes BEFORE INSERT OR UPDATE OF
 scheduled_at,subject,html,amp_html,from_name,from_email,reply_to,sponsor_offer_id,sponsor_brand_id,list_id,server_ids,
 vmta_pool_id,send_window_start,send_window_end,ab_variants,ab_metric,topic,requires_placement,weekly_digest,fatigue_protection
 ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.track_scheduled_campaign_changes();

CREATE FUNCTION public.mark_scheduled_audience_change(_campaigns uuid[],_preparing boolean DEFAULT false)
RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE public.campaigns SET review_revision=gen_random_uuid(),
  approval_changes=CASE WHEN 'audience'=ANY(approval_changes) THEN approval_changes ELSE array_append(approval_changes,'audience') END
 WHERE id=ANY(_campaigns) AND approval_required AND status IN ('queued','paused')
   AND (_preparing OR auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours')
$$;
CREATE FUNCTION public.track_scheduled_audience_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Retries replace existing recipients and never expand the original audience.
  PERFORM public.mark_scheduled_audience_change(ARRAY(SELECT DISTINCT campaign_id FROM inserted WHERE retry_of IS NULL));
 ELSIF TG_OP='DELETE' THEN
  PERFORM public.mark_scheduled_audience_change(ARRAY(SELECT DISTINCT campaign_id FROM removed),true);
 ELSE
  PERFORM public.mark_scheduled_audience_change(ARRAY[OLD.campaign_id,NEW.campaign_id],true);
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER scheduled_audience_insert AFTER INSERT ON public.campaign_messages
 REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION public.track_scheduled_audience_rows();
CREATE TRIGGER scheduled_audience_delete AFTER DELETE ON public.campaign_messages
 REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION public.track_scheduled_audience_rows();
CREATE TRIGGER scheduled_audience_update AFTER UPDATE OF campaign_id,email,first_name,server_id ON public.campaign_messages
 FOR EACH ROW WHEN (ROW(OLD.campaign_id,OLD.email,OLD.first_name,OLD.server_id) IS DISTINCT FROM ROW(NEW.campaign_id,NEW.email,NEW.first_name,NEW.server_id))
 EXECUTE FUNCTION public.track_scheduled_audience_rows();

CREATE FUNCTION public.track_scheduled_sponsor_link()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.campaigns SET review_revision=gen_random_uuid(),
  approval_changes=CASE WHEN 'sponsor_link'=ANY(approval_changes) THEN approval_changes ELSE array_append(approval_changes,'sponsor_link') END
 WHERE sponsor_offer_id=NEW.id AND approval_required AND status IN ('queued','paused');
 RETURN NULL;
END;
$$;
CREATE TRIGGER scheduled_sponsor_link AFTER UPDATE OF tracking_url ON public.sponsor_offers
 FOR EACH ROW WHEN (OLD.tracking_url IS DISTINCT FROM NEW.tracking_url) EXECUTE FUNCTION public.track_scheduled_sponsor_link();

ALTER FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages) RENAME TO campaign_job_ready_before_approval;
CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT (NOT _campaign.approval_required OR (
  _message.server_id=ANY(_campaign.server_ids) AND _campaign.approved_revision=_campaign.review_revision AND EXISTS (
   SELECT 1 FROM public.server_agents a WHERE a.server_id=_message.server_id AND a.metrics->>'campaignApproval'='true'
  ))) AND public.campaign_job_ready_before_approval(_campaign,_message)
$$;

CREATE FUNCTION public.set_claimed_campaign_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 SELECT approved_revision INTO NEW.claimed_revision FROM public.campaigns WHERE id=NEW.campaign_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER claimed_campaign_revision BEFORE UPDATE OF status ON public.campaign_messages
 FOR EACH ROW WHEN (OLD.status='queued' AND NEW.status='claimed') EXECUTE FUNCTION public.set_claimed_campaign_revision();

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_approval;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_approval(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject_approved(_server uuid,_id uuid,_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 job public.campaign_messages;
 campaign public.campaigns;
BEGIN
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(md5(lower(btrim(job.email))),29029));
 SELECT * INTO campaign FROM public.campaigns WHERE id=job.campaign_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO job FROM public.campaign_messages WHERE id=_id AND server_id=_server AND status='claimed' AND campaign_id=campaign.id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT campaign.approval_required THEN RETURN public.agent_may_inject_before_approval(_server,_id); END IF;
 IF job.permit_granted_at IS NOT NULL OR _revision IS DISTINCT FROM job.claimed_revision THEN RETURN false; END IF;
 IF _revision IS NULL OR _revision IS DISTINCT FROM campaign.review_revision OR _revision IS DISTINCT FROM campaign.approved_revision
  OR NOT coalesce(_server=ANY(campaign.server_ids),false) THEN
  UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,claimed_revision=NULL WHERE id=_id;
  RETURN false;
 END IF;
 RETURN public.agent_may_inject_before_approval(_server,_id);
END;
$$;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.agent_may_inject_approved(_server,_id,NULL)
$$;

CREATE FUNCTION public.read_scheduled_campaign_approval(_campaign uuid)
RETURNS TABLE(revision uuid, approved_at timestamptz, pending boolean, changes text[], subject text,
 from_name text, from_email text, reply_to text, html text, amp_html text, variants jsonb, scheduled_at timestamptz,
 list_name text, recipient_count bigint, servers text[], pool text, sponsor_url text, outdated_agents text[], routing_mismatch boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.review_revision,c.approved_at,c.review_revision IS DISTINCT FROM c.approved_revision,c.approval_changes,
  c.subject,c.from_name,c.from_email,c.reply_to,
  CASE WHEN c.review_revision IS DISTINCT FROM c.approved_revision THEN c.html END,
  CASE WHEN c.review_revision IS DISTINCT FROM c.approved_revision THEN c.amp_html END,
  CASE WHEN c.review_revision IS DISTINCT FROM c.approved_revision THEN c.ab_variants END,
  c.scheduled_at,l.name,
  CASE WHEN c.review_revision IS DISTINCT FROM c.approved_revision THEN
   (SELECT count(*) FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.retry_of IS NULL)
   ELSE c.total END,
  ARRAY(SELECT s.label FROM public.managed_servers s WHERE s.id=ANY(c.server_ids) ORDER BY s.label),
  p.name,o.tracking_url,
  ARRAY(SELECT s.label FROM public.managed_servers s LEFT JOIN public.server_agents a ON a.server_id=s.id
   WHERE s.id=ANY(c.server_ids) AND a.metrics->>'campaignApproval' IS DISTINCT FROM 'true' ORDER BY s.label),
  EXISTS (SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.status IN ('queued','claimed')
   AND m.permit_granted_at IS NULL AND NOT coalesce(m.server_id=ANY(c.server_ids),false))
 FROM public.campaigns c LEFT JOIN public.contact_lists l ON l.id=c.list_id
 LEFT JOIN public.vmta_pools p ON p.id=c.vmta_pool_id LEFT JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id
 WHERE c.id=_campaign AND c.approval_required
$$;

CREATE FUNCTION public.approve_scheduled_campaign(_campaign uuid,_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.campaigns c SET approved_revision=_revision,approved_at=clock_timestamp(),approval_changes='{}'
 WHERE c.id=_campaign AND c.approval_required AND c.review_revision=_revision
  AND c.approved_revision IS DISTINCT FROM _revision AND c.status IN ('queued','paused')
  AND c.auto_pause_reason IS DISTINCT FROM 'Préparation des destinataires en cours'
  AND NOT EXISTS (SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id AND m.status IN ('queued','claimed')
   AND m.permit_granted_at IS NULL AND NOT coalesce(m.server_id=ANY(c.server_ids),false));
 IF NOT FOUND THEN RETURN false; END IF;
 -- The older copy has no permit. Its old revision cannot authorize a new claim.
 UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,claimed_revision=NULL
 WHERE campaign_id=_campaign AND status='claimed' AND permit_granted_at IS NULL;
 RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.track_scheduled_campaign_changes(),public.track_scheduled_audience_rows(),
 public.mark_scheduled_audience_change(uuid[],boolean),public.track_scheduled_sponsor_link(),
 public.set_claimed_campaign_revision(),public.campaign_job_ready(public.campaigns,public.campaign_messages)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_may_inject(uuid,uuid),public.agent_may_inject_approved(uuid,uuid,uuid),
 public.read_scheduled_campaign_approval(uuid),public.approve_scheduled_campaign(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_may_inject(uuid,uuid),public.agent_may_inject_approved(uuid,uuid,uuid),
 public.read_scheduled_campaign_approval(uuid),public.approve_scheduled_campaign(uuid,uuid)
 TO service_role;
COMMIT;
