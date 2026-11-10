BEGIN;

CREATE TABLE public.subscription_confirmations (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  email_md5 text NOT NULL CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_confirmations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.subscription_confirmations TO service_role;

CREATE FUNCTION public.confirm_contact_subscription(_list uuid, _email text, _token_hash text)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  address text := lower(btrim(_email));
  recipient text := md5(address);
BEGIN
  PERFORM 1 FROM public.contact_lists WHERE id = _list AND quarantined_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));

  IF EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5 = recipient) OR EXISTS (
    SELECT 1 FROM public.contacts WHERE list_id = _list AND email_md5 = recipient AND status <> 'active'
  ) THEN RETURN 'unavailable'; END IF;

  INSERT INTO public.subscription_confirmations (token_hash, list_id, email_md5)
  VALUES (_token_hash, _list, recipient) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'confirmed'; END IF;

  INSERT INTO public.contacts (list_id, email)
  SELECT _list, address WHERE NOT EXISTS (SELECT 1 FROM public.contacts WHERE list_id = _list AND email_md5 = recipient)
  ON CONFLICT (list_id, email) DO NOTHING;
  RETURN 'confirmed';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_contact_subscription(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_contact_subscription(uuid,text,text) TO service_role;
COMMIT;
