BEGIN;

CREATE INDEX contacts_active_list_cursor ON public.contacts(list_id, id) WHERE status = 'active';

CREATE FUNCTION public.campaign_audience_page(_list uuid, _after uuid, _with_time_zone boolean)
RETURNS TABLE(id uuid, email text, first_name text, time_zone text, suppressed boolean)
LANGUAGE sql STABLE SET search_path=public AS $$
  WITH page AS MATERIALIZED (
    SELECT c.id, c.email, c.first_name, c.time_zone, c.email_md5
    FROM public.contacts c
    WHERE c.list_id = _list AND c.status = 'active' AND (_after IS NULL OR c.id > _after)
    ORDER BY c.id LIMIT 1000
  )
  SELECT p.id, p.email, p.first_name, CASE WHEN _with_time_zone THEN p.time_zone END,
    EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = p.email_md5)
  FROM page p ORDER BY p.id;
$$;

CREATE OR REPLACE FUNCTION public.campaign_sunset_contacts(_ids uuid[], _days integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT contact_id FROM public.campaign_messages
  WHERE _days IN (60,90,365) AND contact_id = ANY(_ids)
  GROUP BY contact_id
  HAVING min(sent_at) FILTER (WHERE delivery_state = 'delivered') < now() - make_interval(days => _days)
    AND COALESCE(max(GREATEST(opened_at, clicked_at)), '-infinity'::timestamptz) < now() - make_interval(days => _days);
$$;

REVOKE ALL ON FUNCTION public.campaign_audience_page(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_audience_page(uuid,uuid,boolean) TO service_role;

COMMIT;
