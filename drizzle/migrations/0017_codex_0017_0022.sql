ALTER TABLE public.campaigns ADD COLUMN scheduled_at timestamptz;

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

ALTER TABLE public.campaign_messages ADD COLUMN available_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.campaign_messages cm SET status='failed',error='Destinataire supprimé avant injection' WHERE cm.server_id=_server AND cm.status='queued' AND EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))));
 RETURN QUERY UPDATE public.campaign_messages m SET status='claimed',claimed_at=now() WHERE m.id IN (
 SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id WHERE cm.server_id=_server AND c.status='queued'
 AND (c.scheduled_at IS NULL OR c.scheduled_at <= now())
 AND (cm.available_at IS NULL OR cm.available_at <= now())
 AND (cm.status='queued' OR (cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'))
 AND NOT EXISTS(SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
 ORDER BY cm.created_at LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF cm SKIP LOCKED) RETURNING m.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;

CREATE TABLE public.incident_notifications (
  event_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (event_key, channel)
);
ALTER TABLE public.incident_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.incident_notifications TO service_role;

CREATE FUNCTION public.claim_incident_notification(_key text, _channel text)
RETURNS boolean LANGUAGE sql SET search_path=public AS $$
  WITH claimed AS (
    INSERT INTO public.incident_notifications (event_key, channel)
    VALUES (_key, _channel)
    ON CONFLICT (event_key,channel) DO UPDATE SET claimed_at=now()
    WHERE incident_notifications.sent_at IS NULL
      AND incident_notifications.claimed_at < now() - interval '5 minutes'
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM claimed)
$$;
REVOKE ALL ON FUNCTION public.claim_incident_notification(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_incident_notification(text,text) TO service_role;

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