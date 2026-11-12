BEGIN;
ALTER TABLE public.managed_servers ADD COLUMN maintenance_since timestamptz;

CREATE FUNCTION public.set_server_maintenance(_server uuid,_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- Share the per-server lock used to reserve campaign messages.
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
 UPDATE public.managed_servers SET maintenance_since=
  CASE WHEN _enabled THEN coalesce(maintenance_since,clock_timestamp()) END
 WHERE id=_server AND (NOT _enabled OR status<>'absent');
 RETURN FOUND;
END;
$$;

ALTER FUNCTION public.claim_campaign_messages(uuid,integer) RENAME TO claim_campaign_messages_before_maintenance;
REVOKE ALL ON FUNCTION public.claim_campaign_messages_before_maintenance(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_server::text,56056));
 IF EXISTS (SELECT 1 FROM public.managed_servers WHERE id=_server AND maintenance_since IS NOT NULL) THEN
  -- Keep reconciliation and expiry cleanup running while new claims are held.
  RETURN QUERY SELECT * FROM public.claim_campaign_messages_before_maintenance(_server,0);
 ELSE
  RETURN QUERY SELECT * FROM public.claim_campaign_messages_before_maintenance(_server,_limit);
 END IF;
END;
$$;

CREATE FUNCTION public.read_server_maintenance(_server uuid)
RETURNS TABLE(maintenance_since timestamptz,queued bigint,claimed bigint,kumo_messages bigint,ready boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.maintenance_since, q.queued, q.claimed, k.messages,
  coalesce(s.maintenance_since IS NOT NULL AND q.claimed=0 AND k.messages=0,false)
 FROM public.managed_servers s
 LEFT JOIN public.server_agents a ON a.server_id=s.id
 CROSS JOIN LATERAL (
   SELECT count(*) FILTER (WHERE m.status='queued') AS queued,
          count(*) FILTER (WHERE m.status='claimed') AS claimed
   FROM public.campaign_messages m
   WHERE m.server_id=s.id AND s.maintenance_since IS NOT NULL AND m.status IN ('queued','claimed')
 ) q
 CROSS JOIN LATERAL (
   SELECT CASE WHEN a.status='online'
     AND (a.metrics #>> '{maintenance,since}')::timestamptz=s.maintenance_since
     AND (a.metrics #>> '{maintenance,receivedAt}')::timestamptz>=greatest(s.maintenance_since,now()-interval '2 minutes')
    THEN (a.metrics #>> '{maintenance,messages}')::bigint END AS messages
 ) k
 WHERE s.id=_server
$$;

ALTER FUNCTION public.read_campaign_queue_priority(uuid) RENAME TO read_campaign_queue_priority_before_maintenance;
REVOKE ALL ON FUNCTION public.read_campaign_queue_priority_before_maintenance(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_campaign_queue_priority(_campaign uuid)
RETURNS TABLE(server_id uuid,label text,priority smallint,per_minute integer,reserved bigint,waiting_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT q.server_id,q.label,q.priority,q.per_minute,q.reserved,
  CASE WHEN s.maintenance_since IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
   WHERE m.campaign_id=_campaign AND m.server_id=s.id AND m.status='queued' AND c.status='queued'
  ) THEN 'maintenance' ELSE q.waiting_reason END
 FROM public.read_campaign_queue_priority_before_maintenance(_campaign) q
 JOIN public.managed_servers s ON s.id=q.server_id
 ORDER BY q.label
$$;

REVOKE ALL ON FUNCTION public.set_server_maintenance(uuid,boolean),public.claim_campaign_messages(uuid,integer),
 public.read_server_maintenance(uuid),public.read_campaign_queue_priority(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_server_maintenance(uuid,boolean),public.claim_campaign_messages(uuid,integer),
 public.read_server_maintenance(uuid),public.read_campaign_queue_priority(uuid) TO service_role;
COMMIT;
