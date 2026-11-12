BEGIN;

ALTER TABLE public.campaign_messages ADD COLUMN delivery_wave smallint CHECK (delivery_wave BETWEEN 1 AND 3);
CREATE INDEX campaign_messages_delivery_wave ON public.campaign_messages(
  campaign_id,public.campaign_recipient_provider(lower(split_part(email,'@',2))),delivery_wave
) WHERE delivery_wave IS NOT NULL;

CREATE TABLE public.campaign_delivery_waves (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  provider text NOT NULL,
  allowed_wave smallint NOT NULL DEFAULT 1 CHECK (allowed_wave BETWEEN 1 AND 3),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,provider)
);
CREATE INDEX campaign_delivery_waves_due ON public.campaign_delivery_waves(next_check_at,campaign_id,provider)
  WHERE allowed_wave<3;
ALTER TABLE public.campaign_delivery_waves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_delivery_waves FROM PUBLIC,anon,authenticated;

-- Existing authorizations keep their original schedule. New authorizations
-- assign waves while preserving each recipient's scheduled availability.
CREATE OR REPLACE FUNCTION public.stage_released_campaign_provider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.campaign_delivery_waves(campaign_id,provider)
  VALUES (NEW.campaign_id,NEW.provider) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;

  WITH ranked AS (
    SELECT m.id,row_number() OVER (
      ORDER BY public.has_recent_delivery_engagement(m.email,30) DESC,m.created_at,m.id
    ) AS position,count(*) OVER () AS size
    FROM public.campaign_messages m WHERE m.campaign_id=NEW.campaign_id AND m.status='queued'
      AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=NEW.provider
  )
  UPDATE public.campaign_messages m SET delivery_wave=CASE
    WHEN ranked.position<=greatest(1,least(25,ceil(ranked.size*0.1))) THEN 1
    WHEN ranked.position<=greatest(2,ceil(ranked.size*0.5)) THEN 2
    ELSE 3 END
  FROM ranked WHERE m.id=ranked.id AND m.status='queued';
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.campaign_wave_ready(_campaign uuid,_email text,_wave smallint)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT _wave IS NULL OR EXISTS (
    SELECT 1 FROM public.campaign_delivery_waves w
    WHERE w.campaign_id=_campaign AND w.allowed_wave>=_wave
      AND w.provider=public.campaign_recipient_provider(lower(split_part(_email,'@',2)))
  )
$$;

CREATE FUNCTION public.read_campaign_wave_status(_campaign uuid)
RETURNS TABLE(provider text,wave smallint,planned integer,accepted integer,deferred integer,bounced integer,
  complaints integer,remaining integer,state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH summary AS (
  SELECT w.provider,w.allowed_wave,c.status,c.auto_pause_reason,
    count(*) FILTER (WHERE m.delivery_wave=w.allowed_wave AND m.status<>'skipped')::integer AS planned,
    count(*) FILTER (WHERE m.delivery_wave=w.allowed_wave AND EXISTS (
      SELECT 1 FROM public.delivery_events e WHERE e.campaign_id=c.id AND e.message_id=m.id
        AND e.event_type='delivered' AND e.smtp_code BETWEEN 200 AND 299
    ))::integer AS accepted,
    count(*) FILTER (WHERE m.delivery_wave=w.allowed_wave AND m.delivery_state='deferred')::integer AS deferred,
    count(*) FILTER (WHERE m.delivery_wave=w.allowed_wave AND m.delivery_state='bounced')::integer AS bounced,
    count(*) FILTER (WHERE m.delivery_wave<=w.allowed_wave AND m.delivery_state='complained')::integer AS complaints,
    count(*) FILTER (WHERE m.delivery_wave>w.allowed_wave AND m.status IN ('queued','claimed'))::integer AS remaining,
    count(*) FILTER (WHERE m.delivery_wave=w.allowed_wave AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)) AS pending,
    max(greatest(m.sent_at,m.permit_granted_at)) FILTER (WHERE m.delivery_wave=w.allowed_wave) AS last_sent,
    EXISTS (
      SELECT 1 FROM public.campaign_placement_releases r
      JOIN public.campaign_placement_monitors p ON p.campaign_id=r.campaign_id
      WHERE r.campaign_id=c.id AND r.provider=w.provider AND p.completed_at IS NOT NULL AND p.unsubscribe_verified
        AND p.observed_at>now()-interval '24 hours'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.seeds) s
          WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))=w.provider)
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.seeds) s
          WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))=w.provider
          AND (s->>'placement' NOT IN ('inbox','promotions')
            OR (s->'authentication'->>'spf') IS DISTINCT FROM 'pass'
            OR (s->'authentication'->>'dkim') IS DISTINCT FROM 'pass'
            OR (s->'authentication'->>'dmarc') IS DISTINCT FROM 'pass'
            OR (s->'authentication'->'one_click') IS DISTINCT FROM 'true'::jsonb))
    ) AS witnesses_ok,
    EXISTS (
      SELECT 1 FROM public.delivery_provider_holds h
      WHERE h.provider=w.provider AND h.sender_domain=lower(split_part(c.from_email,'@',2))
        AND (h.until_at IS NULL OR h.until_at>now())
    ) AS smtp_hold
  FROM public.campaign_delivery_waves w JOIN public.campaigns c ON c.id=w.campaign_id
  JOIN public.campaign_messages m ON m.campaign_id=w.campaign_id AND m.delivery_wave IS NOT NULL
    AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=w.provider
  WHERE w.campaign_id=_campaign
  GROUP BY w.provider,w.allowed_wave,c.id
 )
 SELECT s.provider,s.allowed_wave,s.planned,s.accepted,s.deferred,s.bounced,s.complaints,s.remaining,
   CASE WHEN s.remaining=0 THEN 'last'
        WHEN s.status<>'queued' OR s.auto_pause_reason IS NOT NULL OR s.smtp_hold THEN 'hold'
        WHEN s.complaints>0 THEN 'complaint'
        WHEN NOT s.witnesses_ok THEN 'witness'
        WHEN s.pending>0 THEN 'pending'
        WHEN s.last_sent>now()-interval '10 minutes' THEN 'observing'
        WHEN s.bounced*100.0>s.planned*5.0 THEN 'bounce'
        WHEN s.deferred*100.0>s.planned*10.0 THEN 'deferred'
        WHEN s.planned=0 OR s.accepted<least(5,s.planned) OR s.accepted*100.0<s.planned*90.0 THEN 'insufficient'
        ELSE 'ready' END
 FROM summary s ORDER BY s.provider
$$;

CREATE FUNCTION public.advance_campaign_waves(_server uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  candidate record;
  decision text;
BEGIN
  FOR candidate IN
    SELECT w.campaign_id,w.provider
    FROM public.campaign_delivery_waves w JOIN public.campaigns c ON c.id=w.campaign_id
    WHERE c.status='queued' AND c.auto_pause_reason IS NULL
      AND _server=ANY(c.server_ids) AND (c.scheduled_at IS NULL OR c.scheduled_at<=now())
      AND w.allowed_wave<3 AND w.next_check_at<=now()
      AND EXISTS (
        SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=w.campaign_id
          AND m.delivery_wave>w.allowed_wave AND m.status='queued'
          AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=w.provider
      )
    ORDER BY w.next_check_at,w.campaign_id,w.provider LIMIT 25 FOR NO KEY UPDATE OF c SKIP LOCKED
  LOOP
    SELECT s.state INTO decision FROM public.read_campaign_wave_status(candidate.campaign_id) s
    WHERE s.provider=candidate.provider;
    UPDATE public.campaign_delivery_waves SET
      allowed_wave=allowed_wave+CASE WHEN decision='ready' THEN 1 ELSE 0 END,
      next_check_at=now()+interval '1 minute'
    WHERE campaign_id=candidate.campaign_id AND provider=candidate.provider;
  END LOOP;
END;
$$;

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_waves;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_waves(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.id=_id AND m.server_id=_server
      AND public.campaign_wave_ready(m.campaign_id,m.email,m.delivery_wave)
  ) THEN RETURN false; END IF;
  RETURN public.agent_may_inject_before_waves(_server,_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid,_limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.advance_campaign_waves(_server);
 UPDATE public.campaign_messages m SET
   status=CASE WHEN m.delivery_state='pending' THEN 'failed' ELSE 'sent' END,
   sent_at=CASE WHEN m.delivery_state='pending' THEN m.sent_at ELSE coalesce(m.sent_at,m.permit_granted_at,m.claimed_at) END,
   injection_uncertain_at=CASE WHEN m.delivery_state='pending' THEN now() END,
   error=CASE WHEN m.delivery_state='pending' THEN 'Injection KumoMTA à vérifier' END
 WHERE m.id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='claimed' AND cm.claimed_at<now()-interval '15 minutes'
   ORDER BY cm.claimed_at,cm.id LIMIT 500 FOR UPDATE OF cm SKIP LOCKED
 );
 UPDATE public.campaign_messages SET status='failed',error='Destinataire supprimé avant injection'
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm
   WHERE cm.server_id=_server AND cm.status='queued'
     AND EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   FOR UPDATE OF cm SKIP LOCKED
 );
 RETURN QUERY UPDATE public.campaign_messages SET status='claimed',claimed_at=now()
 WHERE id IN (
   SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND public.campaign_can_claim(c,_server)
     AND public.campaign_message_ready(c,cm.email)
     AND public.campaign_wave_ready(c.id,cm.email,cm.delivery_wave)
     AND (cm.available_at IS NULL OR cm.available_at<=now()) AND cm.status='queued'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_wave_ready(uuid,text,smallint),
  public.advance_campaign_waves(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_campaign_wave_status(uuid),public.agent_may_inject(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_campaign_wave_status(uuid),public.agent_may_inject(uuid,uuid)
  TO service_role;
COMMIT;
