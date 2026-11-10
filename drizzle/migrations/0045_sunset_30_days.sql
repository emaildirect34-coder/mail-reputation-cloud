BEGIN;
CREATE OR REPLACE FUNCTION public.campaign_sunset_contacts(_ids uuid[], _days integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT contact_id FROM public.campaign_messages
  WHERE _days IN (30,60,90,365) AND contact_id = ANY(_ids)
  GROUP BY contact_id
  HAVING min(sent_at) FILTER (WHERE delivery_state = 'delivered') < now() - make_interval(days => _days)
    AND COALESCE(max(GREATEST(opened_at, clicked_at)), '-infinity'::timestamptz) < now() - make_interval(days => _days);
$$;
COMMIT;
