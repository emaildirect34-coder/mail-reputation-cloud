CREATE TABLE public.sponsor_postbacks (account_id uuid PRIMARY KEY REFERENCES public.sponsor_accounts(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, hits integer NOT NULL DEFAULT 0, last_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.sponsor_postbacks TO service_role;
ALTER TABLE public.sponsor_postbacks ENABLE ROW LEVEL SECURITY;