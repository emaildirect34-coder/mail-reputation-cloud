CREATE TABLE public.server_agents (
  server_id uuid PRIMARY KEY REFERENCES public.managed_servers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','online','error')),
  agent_version text,
  kumo_version text,
  config_hash text,
  applied_hash text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.server_agents TO authenticated;
GRANT ALL ON public.server_agents TO service_role;
ALTER TABLE public.server_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY agents_read ON public.server_agents FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin') OR EXISTS (SELECT 1 FROM public.worker_tasks WHERE user_id=auth.uid() AND status='active' AND allowed_paths && ARRAY['/dashboard/servers']::text[]));
REVOKE SELECT (token_hash) ON public.server_agents FROM authenticated;
ALTER TABLE public.server_domain_bindings ADD COLUMN IF NOT EXISTS last_error text;