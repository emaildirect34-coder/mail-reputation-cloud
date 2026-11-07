CREATE OR REPLACE FUNCTION public.add_suppressions(_values text[], _reason text, _source text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.suppressions(email_md5, reason, source)
  SELECT DISTINCT CASE WHEN v ~ '^[0-9a-f]{32}$' THEN v ELSE md5(v) END, _reason, _source
  FROM (SELECT lower(btrim(x)) v FROM unnest(_values) x) s
  WHERE v ~ '^[0-9a-f]{32}$' OR v ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ON CONFLICT (email_md5) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.add_suppressions(text[],text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_suppressions(text[],text,text) TO service_role;