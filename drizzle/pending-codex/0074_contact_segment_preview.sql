BEGIN;

CREATE TABLE public.contact_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  provider text CHECK (provider IN ('Gmail','Microsoft','Yahoo','Orange','SFR','Free','La Poste','Autre')),
  preference text NOT NULL CHECK (preference IN ('any','recorded','none')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  UNIQUE(list_id,name)
);
ALTER TABLE public.contact_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_segments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.contact_segments TO service_role;

CREATE FUNCTION public.contact_segment_matches(_contact public.contacts,_provider text,_preference text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT (_provider IS NULL OR CASE
    WHEN lower(split_part(_contact.email,'@',2))='laposte.net' THEN 'La Poste'
    WHEN public.campaign_recipient_provider(lower(split_part(_contact.email,'@',2))) IN ('Gmail','Microsoft','Yahoo','Orange','SFR','Free')
      THEN public.campaign_recipient_provider(lower(split_part(_contact.email,'@',2)))
    ELSE 'Autre' END=_provider)
    AND (_preference='any' OR (_preference='recorded')=EXISTS(
      SELECT 1 FROM public.recipient_topic_preferences p WHERE p.email_md5=_contact.email_md5
    ))
$$;

CREATE FUNCTION public.preview_contact_segment(_list uuid,_segment uuid,_provider text,_preference text)
RETURNS TABLE(revision uuid,previous bigint,next bigint,entering bigint,leaving bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH chosen AS (
   SELECT s.revision,s.provider,s.preference FROM public.contact_segments s WHERE s.id=_segment AND s.list_id=_list
 ), counts AS (
   SELECT (_segment IS NOT NULL AND EXISTS (
      SELECT 1 FROM chosen p WHERE public.contact_segment_matches(c,p.provider,p.preference)
    )) AS old_match,public.contact_segment_matches(c,_provider,_preference) AS new_match
   FROM public.contacts c
   WHERE c.list_id=_list AND c.status='active'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=c.email_md5)
 )
 SELECT (SELECT chosen.revision FROM chosen),count(*) FILTER (WHERE old_match),count(*) FILTER (WHERE new_match),
  count(*) FILTER (WHERE NOT old_match AND new_match),count(*) FILTER (WHERE old_match AND NOT new_match)
 FROM counts
$$;

CREATE FUNCTION public.filter_contact_segment_page(_list uuid,_ids uuid[],_provider text,_preference text)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.id FROM public.contacts c WHERE c.list_id=_list AND c.id=ANY(_ids)
   AND public.contact_segment_matches(c,_provider,_preference)
$$;

REVOKE ALL ON FUNCTION public.contact_segment_matches(public.contacts,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_contact_segment(uuid,uuid,text,text),public.filter_contact_segment_page(uuid,uuid[],text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_contact_segment(uuid,uuid,text,text),public.filter_contact_segment_page(uuid,uuid[],text,text) TO service_role;
COMMIT;
