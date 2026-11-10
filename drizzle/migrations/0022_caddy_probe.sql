BEGIN;
CREATE TABLE public.caddy_probe_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  checked_at timestamptz NOT NULL,
  failed_checks integer NOT NULL CHECK (failed_checks BETWEEN 0 AND 2),
  incident_since timestamptz
);
ALTER TABLE public.caddy_probe_state ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.caddy_probe_state TO service_role;

CREATE FUNCTION public.record_caddy_probe(_healthy boolean, _checked_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql SET search_path = public AS $$
DECLARE incident timestamptz;
BEGIN
  INSERT INTO public.caddy_probe_state (singleton, checked_at, failed_checks)
  VALUES (true, _checked_at, CASE WHEN _healthy THEN 0 ELSE 1 END)
  ON CONFLICT (singleton) DO UPDATE SET
    checked_at = EXCLUDED.checked_at,
    failed_checks = CASE WHEN _healthy THEN 0 ELSE LEAST(2, caddy_probe_state.failed_checks + 1) END,
    incident_since = CASE
      WHEN _healthy THEN NULL
      WHEN caddy_probe_state.failed_checks >= 1
      THEN COALESCE(caddy_probe_state.incident_since, caddy_probe_state.checked_at)
      ELSE NULL
    END
  WHERE EXCLUDED.checked_at > caddy_probe_state.checked_at
  RETURNING incident_since INTO incident;
  RETURN incident;
END;
$$;
REVOKE ALL ON FUNCTION public.record_caddy_probe(boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_caddy_probe(boolean,timestamptz) TO service_role;
COMMIT;
