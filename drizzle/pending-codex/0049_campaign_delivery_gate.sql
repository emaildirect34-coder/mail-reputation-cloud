BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN requires_placement boolean NOT NULL DEFAULT false,
  ADD COLUMN placement_probe_of uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN placement_probe_token text CHECK (placement_probe_token ~ '^ED-[A-Z0-9]{5,32}$');
ALTER TABLE public.campaign_placement_monitors ADD COLUMN unsubscribe_verified boolean NOT NULL DEFAULT false;

CREATE TABLE public.campaign_placement_releases (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  provider text NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,provider)
);
ALTER TABLE public.campaign_placement_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_placement_releases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.campaign_placement_releases TO service_role;

CREATE FUNCTION public.campaign_recipient_provider(_domain text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT CASE
  WHEN _domain IN ('gmail.com','googlemail.com') THEN 'Gmail'
  WHEN _domain IN ('outlook.com','hotmail.com','live.com','msn.com','hotmail.fr','live.fr','outlook.fr') THEN 'Microsoft'
  WHEN _domain IN ('yahoo.com','yahoo.fr','aol.com') THEN 'Yahoo'
  WHEN _domain IN ('orange.fr','wanadoo.fr','wanadoo.es') THEN 'Orange'
  WHEN _domain IN ('free.fr','aliceadsl.fr','libertysurf.fr') THEN 'Free'
  WHEN _domain IN ('sfr.fr','neuf.fr','cegetel.net','numericable.fr','club-internet.fr') THEN 'SFR'
  ELSE _domain END
$$;

CREATE FUNCTION public.hold_failed_placement_provider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM public.campaign_placement_releases r
  WHERE r.campaign_id=NEW.campaign_id AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.seeds) s
    WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))=r.provider
      AND (s->>'placement' NOT IN ('inbox','promotions')
        OR (s->'authentication'->>'spf') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->>'dkim') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->>'dmarc') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->'one_click') IS DISTINCT FROM 'true'::jsonb)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER hold_failed_placement_provider AFTER UPDATE OF completed_at ON public.campaign_placement_monitors
FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
EXECUTE FUNCTION public.hold_failed_placement_provider();

CREATE FUNCTION public.start_campaign_preflight(
  _campaign uuid,_server uuid,_placement text,_token text,_expires timestamptz,_seeds jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  source public.campaigns;
  test_id uuid;
  addresses text[];
  synthetic_address text;
  synthetic_id uuid;
  synthetic_token text;
BEGIN
  SELECT * INTO STRICT source FROM public.campaigns WHERE id=_campaign FOR UPDATE;
  IF NOT source.requires_placement OR source.status NOT IN ('paused','queued')
     OR cardinality(source.server_ids)<>1 OR NOT (_server=ANY(source.server_ids))
     OR NOT EXISTS (SELECT 1 FROM public.server_agents WHERE server_id=_server) OR _expires<=now()
     OR _token !~ '^ED-[A-Z0-9]{5,32}$' THEN
    RAISE EXCEPTION 'Placement test unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_placement_monitors WHERE campaign_id=_campaign
      AND completed_at IS NULL AND expires_at>now()) THEN RETURN; END IF;
  SELECT array_agg(DISTINCT lower(seed->>'address')) INTO addresses FROM jsonb_array_elements(_seeds) seed;
  IF coalesce(cardinality(addresses),0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid seed count'; END IF;
  INSERT INTO public.campaigns(name,from_name,from_email,reply_to,subject,html,amp_html,
    server_ids,vmta_pool_id,status,total,created_by,placement_probe_token,placement_probe_of)
  VALUES ('Test Inbox '||_token,source.from_name,source.from_email,source.reply_to,source.subject,
    source.html,source.amp_html,ARRAY[_server],source.vmta_pool_id,'queued',cardinality(addresses),source.created_by,_token,source.id)
  RETURNING id INTO test_id;
  INSERT INTO public.campaign_messages(campaign_id,server_id,email)
  SELECT test_id,_server,address FROM unnest(addresses) address;

  -- Exercise the same unsubscribe operation and suppression predicate as
  -- production, without altering a real seed account or exposing a test token.
  synthetic_address := 'placement-'||test_id::text||'@example.invalid';
  INSERT INTO public.campaign_messages(campaign_id,server_id,email)
  VALUES (test_id,_server,synthetic_address) RETURNING id,unsub_token INTO synthetic_id,synthetic_token;
  PERFORM public.unsubscribe_campaign_message(synthetic_token);
  DELETE FROM public.suppressions s WHERE s.email_md5=md5(synthetic_address)
    AND s.reason='unsubscribe' AND s.source='campagne '||test_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unsubscribe did not suppress the test recipient'; END IF;
  DELETE FROM public.campaign_messages WHERE id=synthetic_id;

  INSERT INTO public.campaign_placement_monitors(campaign_id,test_campaign_id,server_id,placement_id,expires_at,seeds,unsubscribe_verified)
  VALUES (_campaign,test_id,_server,_placement,_expires,_seeds,true)
  ON CONFLICT (campaign_id) DO UPDATE SET
    test_campaign_id=EXCLUDED.test_campaign_id, server_id=EXCLUDED.server_id,
    placement_id=EXCLUDED.placement_id, expires_at=EXCLUDED.expires_at, seeds=EXCLUDED.seeds,
    observed_at=NULL, completed_at=NULL, unsubscribe_verified=true;
END;
$$;

CREATE FUNCTION public.release_campaign_provider(_campaign uuid,_provider text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  source public.campaigns;
  evidence jsonb;
BEGIN
  SELECT * INTO source FROM public.campaigns WHERE id=_campaign FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT source.requires_placement OR source.status NOT IN ('paused','queued')
    OR (source.status='paused' AND source.auto_pause_reason IS NULL)
    OR (source.auto_pause_reason IS NOT NULL AND source.auto_pause_reason <> 'Contrôle des boîtes témoins en attente')
  THEN RETURN false; END IF;
  SELECT seeds INTO evidence FROM public.campaign_placement_monitors WHERE campaign_id=_campaign AND completed_at IS NOT NULL AND unsubscribe_verified
    AND observed_at > now()-interval '24 hours' FOR SHARE;
  IF evidence IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(evidence) s
    WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))=_provider
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(evidence) s
    WHERE public.campaign_recipient_provider(lower(split_part(s->>'address','@',2)))=_provider
      AND (s->>'placement' NOT IN ('inbox','promotions')
        OR (s->'authentication'->>'spf') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->>'dkim') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->>'dmarc') IS DISTINCT FROM 'pass'
        OR (s->'authentication'->'one_click') IS DISTINCT FROM 'true'::jsonb)
  ) THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=_campaign AND m.status='queued'
      AND public.campaign_recipient_provider(lower(split_part(m.email,'@',2)))=_provider
  ) THEN RETURN false; END IF;
  INSERT INTO public.campaign_placement_releases(campaign_id,provider) VALUES (_campaign,_provider)
    ON CONFLICT (campaign_id,provider) DO UPDATE SET released_at=now();
  UPDATE public.campaigns SET status='queued',auto_pause_reason=NULL WHERE id=_campaign;
  RETURN true;
END;
$$;

CREATE FUNCTION public.campaign_message_ready(_campaign public.campaigns,_email text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT _campaign.requires_placement OR EXISTS (
   SELECT 1 FROM public.campaign_placement_releases r WHERE r.campaign_id=_campaign.id
    AND r.provider=public.campaign_recipient_provider(lower(split_part(_email,'@',2)))
 )
$$;

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_placement;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_placement(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
    WHERE m.id=_id AND m.server_id=_server AND public.campaign_message_ready(c,m.email)
  ) THEN
    UPDATE public.campaign_messages SET status='queued',claimed_at=NULL
    WHERE id=_id AND server_id=_server AND status='claimed' AND permit_granted_at IS NULL;
    RETURN false;
  END IF;
  RETURN public.agent_may_inject_before_placement(_server,_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
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
     AND (cm.available_at IS NULL OR cm.available_at <= now()) AND cm.status='queued'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id LIMIT GREATEST(0,LEAST(_limit,500)) FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.start_campaign_preflight(uuid,uuid,text,text,timestamptz,jsonb),
  public.release_campaign_provider(uuid,text), public.agent_may_inject(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_campaign_preflight(uuid,uuid,text,text,timestamptz,jsonb),
  public.release_campaign_provider(uuid,text), public.agent_may_inject(uuid,uuid) TO service_role;
COMMIT;
