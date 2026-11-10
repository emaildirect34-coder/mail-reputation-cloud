BEGIN;

ALTER TABLE public.contacts ADD COLUMN time_zone text;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_time_zone_format
  CHECK (time_zone IS NULL OR (length(time_zone) <= 80 AND time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'));

CREATE FUNCTION public.import_contacts_with_time_zones(_list uuid, _contacts jsonb)
RETURNS void LANGUAGE sql SET search_path=public AS $$
  INSERT INTO public.contacts AS contact(list_id, email, first_name, time_zone)
  SELECT _list, entry.email, entry.first_name, entry.time_zone
  FROM jsonb_to_recordset(_contacts) AS entry(email text, first_name text, time_zone text)
  ON CONFLICT (list_id, email) DO UPDATE SET time_zone = EXCLUDED.time_zone
  WHERE EXCLUDED.time_zone IS NOT NULL AND contact.time_zone IS DISTINCT FROM EXCLUDED.time_zone;
$$;
REVOKE ALL ON FUNCTION public.import_contacts_with_time_zones(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_contacts_with_time_zones(uuid,jsonb) TO service_role;

COMMIT;
