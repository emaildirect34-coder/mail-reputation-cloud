CREATE TABLE public.sending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  account_id uuid REFERENCES public.provider_accounts(id) ON DELETE SET NULL,
  zone_id text,
  ip text,
  selector_a text NOT NULL,
  selector_b text NOT NULL,
  dkim_pub_a text NOT NULL,
  dkim_pub_b text NOT NULL,
  dkim_priv_a text NOT NULL,
  dkim_priv_b text NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz,
  synced_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sending_domains TO service_role;
ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;