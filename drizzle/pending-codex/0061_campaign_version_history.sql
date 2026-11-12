BEGIN;

ALTER TABLE public.campaigns ADD COLUMN history_digest_source text;

CREATE TABLE public.campaign_versions (
 campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK (version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL CHECK (source IN ('existing','created','edited','sponsor')),
 snapshot jsonb NOT NULL,
 PRIMARY KEY (campaign_id,version)
);
ALTER TABLE public.campaign_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.campaign_versions TO service_role;

CREATE FUNCTION public.campaign_version_snapshot(_campaign public.campaigns)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object(
  'name',_campaign.name,'subject',_campaign.subject,'fromName',_campaign.from_name,
  'fromEmail',_campaign.from_email,'replyTo',_campaign.reply_to,'html',_campaign.html,'ampHtml',_campaign.amp_html,
  'weeklyDigest',_campaign.weekly_digest,'digestSource',_campaign.history_digest_source,
  'sponsorId',_campaign.sponsor_offer_id,'sponsorName',o.name,'sponsorUrl',o.tracking_url,'topic',_campaign.topic,
  'scheduledAt',_campaign.scheduled_at,'listId',_campaign.list_id,'listName',l.name,
  'servers',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',s.id,'label',s.label) ORDER BY s.label,s.id)
    FROM public.managed_servers s WHERE s.id=ANY(_campaign.server_ids)
  ),'[]'::jsonb),'poolId',_campaign.vmta_pool_id,'poolName',p.name,
  'priority',_campaign.send_priority,'windowStart',_campaign.send_window_start,'windowEnd',_campaign.send_window_end,
  'variants',_campaign.ab_variants
 )
 FROM (SELECT 1) singleton
 LEFT JOIN public.sponsor_offers o ON o.id=_campaign.sponsor_offer_id
 LEFT JOIN public.contact_lists l ON l.id=_campaign.list_id
 LEFT JOIN public.vmta_pools p ON p.id=_campaign.vmta_pool_id
$$;

-- Existing campaigns have one baseline, timestamped when the history is enabled.
INSERT INTO public.campaign_versions(campaign_id,version,source,snapshot)
 SELECT c.id,1,'existing',public.campaign_version_snapshot(c)
 FROM public.campaigns c WHERE c.list_id IS NOT NULL AND c.placement_probe_of IS NULL AND NOT c.purchase_thank_you;

CREATE FUNCTION public.archive_campaign_version(_campaign public.campaigns,_source text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
 previous public.campaign_versions;
 current_snapshot jsonb;
BEGIN
 IF _campaign.placement_probe_of IS NOT NULL OR _campaign.purchase_thank_you THEN RETURN; END IF;
 -- The campaign row is locked by the caller, including sponsor edits.
 SELECT * INTO previous FROM public.campaign_versions v WHERE v.campaign_id=_campaign.id ORDER BY v.version DESC LIMIT 1;
 IF _campaign.list_id IS NULL AND previous.version IS NULL THEN RETURN; END IF;
 current_snapshot := public.campaign_version_snapshot(_campaign);
 IF current_snapshot IS NOT DISTINCT FROM previous.snapshot THEN RETURN; END IF;
 INSERT INTO public.campaign_versions(campaign_id,version,source,snapshot)
 VALUES (_campaign.id,coalesce(previous.version,0)+1,_source,current_snapshot);
END;
$$;

CREATE FUNCTION public.archive_campaign_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.archive_campaign_version(NEW,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'edited' END);
 RETURN NULL;
END;
$$;

CREATE TRIGGER archive_campaign_row AFTER INSERT OR UPDATE OF
 name,subject,from_name,from_email,reply_to,html,amp_html,weekly_digest,history_digest_source,
 sponsor_offer_id,topic,scheduled_at,list_id,server_ids,vmta_pool_id,send_priority,send_window_start,send_window_end,ab_variants
 ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.archive_campaign_row();

CREATE FUNCTION public.archive_campaign_sponsor_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.campaigns;
BEGIN
 FOR c IN SELECT * FROM public.campaigns
  WHERE sponsor_offer_id=NEW.id AND status IN ('queued','paused') AND list_id IS NOT NULL
  ORDER BY id FOR NO KEY UPDATE
 LOOP
  PERFORM public.archive_campaign_version(c,'sponsor');
 END LOOP;
 RETURN NULL;
END;
$$;
CREATE TRIGGER version_campaign_sponsor_link AFTER UPDATE OF tracking_url ON public.sponsor_offers
 FOR EACH ROW WHEN (OLD.tracking_url IS DISTINCT FROM NEW.tracking_url) EXECUTE FUNCTION public.archive_campaign_sponsor_link();

REVOKE ALL ON FUNCTION public.campaign_version_snapshot(public.campaigns),
 public.archive_campaign_version(public.campaigns,text),public.archive_campaign_row(),public.archive_campaign_sponsor_link()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
