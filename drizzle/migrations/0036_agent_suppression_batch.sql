BEGIN;

CREATE FUNCTION public.agent_confirm_suppressions(_server uuid, _ids uuid[])
RETURNS uuid[] LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  removed uuid[];
  campaigns uuid[];
BEGIN
  IF _ids IS NULL OR cardinality(_ids) > 200 THEN RAISE EXCEPTION 'Invalid suppression batch'; END IF;
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO campaigns
  FROM public.campaigns c WHERE EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id = c.id AND m.server_id = _server
      AND m.id = ANY(_ids) AND m.status = 'claimed' AND m.permit_granted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(m.email))))
  );
  PERFORM c.id FROM public.campaigns c WHERE c.id = ANY(campaigns) ORDER BY c.id FOR NO KEY UPDATE;

  WITH discarded AS (
    UPDATE public.campaign_messages m SET status = 'failed', error = 'Destinataire supprimé avant injection'
    WHERE m.server_id = _server AND m.campaign_id = ANY(campaigns) AND m.id = ANY(_ids) AND m.status = 'claimed' AND m.permit_granted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(m.email))))
    RETURNING m.id
  ) SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO removed FROM discarded;

  IF cardinality(removed) > 0 THEN
    UPDATE public.campaigns c SET status = 'done'
    WHERE c.id = ANY(campaigns) AND c.status = 'queued' AND NOT EXISTS (
      SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id = c.id AND m.status IN ('queued', 'claimed')
    );
  END IF;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_confirm_suppressions(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_confirm_suppressions(uuid,uuid[]) TO service_role;
COMMIT;
