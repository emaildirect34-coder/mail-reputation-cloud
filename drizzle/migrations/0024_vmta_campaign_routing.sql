BEGIN;

ALTER TABLE public.campaigns ADD COLUMN vmta_pool_id uuid REFERENCES public.vmta_pools(id) ON DELETE RESTRICT;
ALTER TABLE public.server_agents
  ADD COLUMN vmta_inventory_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN vmta_config_hash text;

CREATE FUNCTION public.invalidate_vmta_ip_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.server_id,OLD.address,OLD.family,OLD.pool_id,OLD.active,OLD.quarantined_at,OLD.rdns)
    IS NOT DISTINCT FROM (NEW.server_id,NEW.address,NEW.family,NEW.pool_id,NEW.active,NEW.quarantined_at,NEW.rdns) THEN
    RETURN NULL;
  END IF;
  UPDATE public.server_agents
  SET vmta_inventory_revision=gen_random_uuid(),vmta_config_hash=NULL
  WHERE server_id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.server_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.server_id END
  );
  RETURN NULL;
END;
$$;
CREATE TRIGGER server_ips_invalidate_vmta_inventory
  AFTER INSERT OR DELETE OR UPDATE OF server_id,address,family,pool_id,active,quarantined_at,rdns
  ON public.server_ips FOR EACH ROW EXECUTE FUNCTION public.invalidate_vmta_ip_inventory();

CREATE FUNCTION public.invalidate_vmta_pool_inventory()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF (OLD.status,OLD.purpose) IS DISTINCT FROM (NEW.status,NEW.purpose) THEN
    UPDATE public.server_agents SET vmta_inventory_revision=gen_random_uuid(),vmta_config_hash=NULL
    WHERE server_id IN (SELECT server_id FROM public.server_ips WHERE pool_id=NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER vmta_pools_invalidate_inventory
  AFTER UPDATE OF status,purpose ON public.vmta_pools
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_vmta_pool_inventory();

CREATE OR REPLACE FUNCTION public.campaign_can_claim(_campaign public.campaigns, _server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _campaign.status='queued' AND _campaign.auto_pause_reason IS NULL
   AND (_campaign.scheduled_at IS NULL OR _campaign.scheduled_at <= now())
   AND NOT EXISTS (
     SELECT 1 FROM public.contact_lists
     WHERE id=_campaign.list_id AND quarantined_at IS NOT NULL
   )
   AND EXISTS (
     SELECT 1 FROM public.server_agents agent
     WHERE agent.server_id=_server
     AND CASE
       WHEN agent.metrics->>'vmtaRouting' = 'true'
        AND substring(agent.kumo_version FROM '^kumod ([0-9]{4}\.[0-9]{2}\.[0-9]{2})') >= '2026.09.29'
       THEN agent.status='online' AND agent.vmta_config_hash IS NOT NULL
        AND agent.applied_hash=agent.vmta_config_hash
        AND EXISTS (
          SELECT 1 FROM public.server_ips ip
          LEFT JOIN public.vmta_pools pool ON pool.id=ip.pool_id
          WHERE ip.server_id=_server AND ip.active AND ip.family=4 AND ip.quarantined_at IS NULL
          AND (
            (_campaign.vmta_pool_id IS NULL AND ip.pool_id IS NULL)
            OR (pool.purpose='marketing' AND pool.status='active'
                AND (_campaign.vmta_pool_id IS NULL OR pool.id=_campaign.vmta_pool_id))
          )
        )
       ELSE false
     END
   );
$$;

COMMIT;
