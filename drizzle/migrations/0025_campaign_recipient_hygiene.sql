BEGIN;

CREATE INDEX campaign_messages_contact_email_activity
  ON public.campaign_messages (lower(btrim(email)))
  WHERE contact_id IS NOT NULL;

CREATE FUNCTION public.campaign_sunset_contacts_by_isp(_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path=public AS $$
  WITH selected AS (
    SELECT id, lower(btrim(email)) AS email,
      CASE
        WHEN lower(split_part(email, '@', 2)) IN ('gmail.com','googlemail.com','yahoo.com','yahoo.fr','aol.com','ymail.com','rocketmail.com') THEN 30
        WHEN lower(split_part(email, '@', 2)) IN ('orange.fr','wanadoo.fr','sfr.fr','neuf.fr','free.fr') THEN 60
        ELSE 90
      END AS days
    FROM public.contacts
    WHERE id = ANY(_ids)
  )
  SELECT selected.id
  FROM selected
  JOIN public.campaign_messages AS history
    ON lower(btrim(history.email)) = selected.email AND history.contact_id IS NOT NULL
  GROUP BY selected.id, selected.days
  HAVING min(history.sent_at) FILTER (WHERE history.delivery_state = 'delivered') < now() - make_interval(days => selected.days)
    AND COALESCE(max(GREATEST(history.opened_at, history.clicked_at)), '-infinity'::timestamptz) < now() - make_interval(days => selected.days);
$$;

REVOKE ALL ON FUNCTION public.campaign_sunset_contacts_by_isp(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_sunset_contacts_by_isp(uuid[]) TO service_role;
COMMIT;
