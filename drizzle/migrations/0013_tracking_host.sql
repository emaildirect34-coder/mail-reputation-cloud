ALTER TABLE public.sending_domains ADD COLUMN IF NOT EXISTS tracking_host text CHECK (tracking_host IS NULL OR tracking_host ~ '^[a-z0-9.-]+$');
