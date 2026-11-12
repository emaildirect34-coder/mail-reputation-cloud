BEGIN;
CREATE TABLE public.server_config_revisions (
  server_id uuid NOT NULL REFERENCES public.managed_servers(id) ON DELETE CASCADE,
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(server_id,config_hash)
);
CREATE INDEX server_config_revisions_recent ON public.server_config_revisions(server_id,first_seen_at DESC);
ALTER TABLE public.server_config_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.server_config_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.server_config_revisions TO service_role;
CREATE FUNCTION public.record_server_config_revision(_server uuid,_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF _hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 INSERT INTO public.server_config_revisions(server_id,config_hash) VALUES(_server,_hash) ON CONFLICT DO NOTHING;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_server_config_revision(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_server_config_revision(uuid,text) TO service_role;
COMMIT;
