CREATE TABLE public.provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL,
  auth_type text NOT NULL DEFAULT 'token',
  secret text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'unchecked',
  info jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz
);
GRANT ALL ON public.provider_accounts TO service_role;
ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.managed_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.provider_accounts(id) ON DELETE SET NULL,
  provider text NOT NULL,
  external_id text,
  label text NOT NULL,
  region text,
  plan text,
  monthly_price numeric,
  ipv4 text,
  status text NOT NULL DEFAULT 'provisioning',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.managed_servers TO authenticated;
GRANT ALL ON public.managed_servers TO service_role;
ALTER TABLE public.managed_servers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superadmin reads servers" ON public.managed_servers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));