BEGIN;
CREATE INDEX IF NOT EXISTS campaigns_server_ids_gin ON public.campaigns USING gin(server_ids);

CREATE FUNCTION public.agent_campaign_holds(_server uuid)
RETURNS uuid[] LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
  FROM public.campaigns c
  LEFT JOIN public.contact_lists l ON l.id = c.list_id
  WHERE c.server_ids @> ARRAY[_server]
    AND (c.status IN ('paused','cancelled') OR c.auto_pause_reason IS NOT NULL OR l.quarantined_at IS NOT NULL);
$$;

CREATE FUNCTION public.agent_campaign_releases(_server uuid, _ids uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
  FROM public.campaigns c
  LEFT JOIN public.contact_lists l ON l.id = c.list_id
  WHERE c.server_ids @> ARRAY[_server] AND c.id = ANY(_ids)
    AND c.auto_pause_reason IS NULL AND l.quarantined_at IS NULL
    AND (public.campaign_can_claim(c,_server) OR c.status = 'done');
$$;

CREATE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= now() - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= now())
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(cm.email))))
  );
$$;

REVOKE ALL ON FUNCTION public.agent_campaign_holds(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agent_campaign_releases(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.agent_may_inject(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_campaign_holds(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_campaign_releases(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_may_inject(uuid,uuid) TO service_role;
COMMIT;
