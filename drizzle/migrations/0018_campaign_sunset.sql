BEGIN;
ALTER TABLE public.campaign_messages ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.campaign_messages ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
CREATE INDEX campaign_messages_contact_activity
  ON public.campaign_messages(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE FUNCTION public.campaign_sunset_contacts(_ids uuid[], _days integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT contact_id
  FROM public.campaign_messages
  WHERE _days IN (60,90) AND contact_id = ANY(_ids)
  GROUP BY contact_id
  HAVING min(sent_at) FILTER (WHERE delivery_state = 'delivered') < now() - make_interval(days => _days)
    AND COALESCE(max(GREATEST(opened_at, clicked_at)), '-infinity'::timestamptz) < now() - make_interval(days => _days);
$$;

REVOKE ALL ON FUNCTION public.campaign_sunset_contacts(uuid[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_sunset_contacts(uuid[],integer) TO service_role;
COMMIT;
