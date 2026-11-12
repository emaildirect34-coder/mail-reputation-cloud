BEGIN;

CREATE TABLE public.campaign_no_send_days (
  day date PRIMARY KEY,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 160)
);
ALTER TABLE public.campaign_no_send_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_no_send_days FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.campaign_no_send_days TO service_role;

CREATE FUNCTION public.set_campaign_no_send_day(_day date,_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _day IS NULL OR (_reason IS NOT NULL AND (_day<(now() AT TIME ZONE 'UTC')::date
    OR char_length(btrim(_reason)) NOT BETWEEN 1 AND 160)) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(72072);
  IF _reason IS NULL THEN
    DELETE FROM public.campaign_no_send_days WHERE day=_day;
  ELSE
    INSERT INTO public.campaign_no_send_days VALUES (_day,btrim(_reason))
    ON CONFLICT (day) DO UPDATE SET reason=excluded.reason;
  END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages) RENAME TO campaign_job_ready_before_calendar;
CREATE FUNCTION public.campaign_job_ready(_campaign public.campaigns,_message public.campaign_messages)
RETURNS boolean LANGUAGE sql SET search_path=public AS $$
  SELECT public.campaign_job_ready_before_calendar(_campaign,_message)
   AND (_campaign.list_id IS NULL OR (
    NOT EXISTS (SELECT 1 FROM public.campaign_no_send_days WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date)
    AND (NOT EXISTS (SELECT 1 FROM public.campaign_no_send_days WHERE day>=(clock_timestamp() AT TIME ZONE 'UTC')::date)
      OR EXISTS (SELECT 1 FROM public.server_agents a WHERE a.server_id=_message.server_id AND a.metrics->>'preferencePermit'='true'))
   ))
$$;

ALTER FUNCTION public.agent_may_inject_approved(uuid,uuid,uuid) RENAME TO agent_may_inject_before_calendar;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_calendar(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject_approved(_server uuid,_id uuid,_revision uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
    WHERE m.id=_id AND m.server_id=_server AND c.list_id IS NOT NULL
  ) THEN
    PERFORM pg_advisory_xact_lock_shared(72072);
    IF EXISTS (SELECT 1 FROM public.campaign_no_send_days WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN
      UPDATE public.campaign_messages SET status='queued',claimed_at=NULL,claimed_revision=NULL
      WHERE id=_id AND server_id=_server AND status='claimed' AND permit_granted_at IS NULL;
      RETURN false;
    END IF;
  END IF;
  RETURN public.agent_may_inject_before_calendar(_server,_id,_revision);
END;
$$;

CREATE TABLE public.campaign_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('hypothesis','observation','decision')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_notes_recent ON public.campaign_notes(campaign_id,created_at DESC,id);
ALTER TABLE public.campaign_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_notes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.campaign_notes TO service_role;
REVOKE ALL ON FUNCTION public.campaign_job_ready(public.campaigns,public.campaign_messages),
  public.campaign_job_ready_before_calendar(public.campaigns,public.campaign_messages) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_campaign_no_send_day(date,text),public.agent_may_inject_approved(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_campaign_no_send_day(date,text),public.agent_may_inject_approved(uuid,uuid,uuid) TO service_role;
COMMIT;
