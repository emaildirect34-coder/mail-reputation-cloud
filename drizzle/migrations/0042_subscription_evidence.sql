BEGIN;
ALTER TABLE public.subscription_confirmations
  ADD COLUMN proof_payload text,
  ADD COLUMN proof_signature text,
  ADD CONSTRAINT subscription_proof_pair CHECK (
    (proof_payload IS NULL AND proof_signature IS NULL)
    OR (proof_payload IS NOT NULL AND octet_length(proof_payload) <= 8192
        AND proof_signature IS NOT NULL AND proof_signature ~ '^[0-9a-f]{64}$')
  );
CREATE INDEX subscription_confirmations_lookup
  ON public.subscription_confirmations (list_id, email_md5, confirmed_at DESC);

DROP FUNCTION public.confirm_contact_subscription(uuid,text,text);
CREATE FUNCTION public.confirm_contact_subscription(_list uuid, _email text, _token_hash text, _proof_payload text DEFAULT NULL, _proof_signature text DEFAULT NULL)
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

  INSERT INTO public.subscription_confirmations (token_hash, list_id, email_md5, proof_payload, proof_signature)
  VALUES (_token_hash, _list, recipient, _proof_payload, _proof_signature) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'confirmed'; END IF;

  INSERT INTO public.contacts (list_id, email)
  SELECT _list, address WHERE NOT EXISTS (SELECT 1 FROM public.contacts WHERE list_id = _list AND email_md5 = recipient)
  ON CONFLICT (list_id, email) DO NOTHING;
  RETURN 'confirmed';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_contact_subscription(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_contact_subscription(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.read_contact_subscription_proofs(_list uuid, _email text)
RETURNS TABLE (token_hash text, confirmed_at timestamptz, proof_payload text, proof_signature text)
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT token_hash, confirmed_at, proof_payload, proof_signature
  FROM public.subscription_confirmations
  WHERE list_id = _list AND email_md5 = md5(lower(btrim(_email)))
  ORDER BY confirmed_at DESC LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.read_contact_subscription_proofs(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contact_subscription_proofs(uuid,text) TO service_role;
COMMIT;
