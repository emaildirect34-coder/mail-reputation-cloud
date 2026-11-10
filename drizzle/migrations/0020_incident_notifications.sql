BEGIN;
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
COMMIT;
