ALTER TABLE public.campaigns ADD COLUMN fatigue_protection boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.recipient_fatigue_until(_recipient text, _message uuid, _at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=public AS $$
  WITH activity AS (
    SELECT greatest(cm.sent_at, cm.permit_granted_at) AS exposure, cm.clicked_at
    FROM public.campaign_messages cm
    WHERE md5(lower(btrim(cm.email))) = _recipient AND cm.id <> _message
      AND (cm.sent_at IS NOT NULL OR cm.permit_granted_at IS NOT NULL)
      AND greatest(cm.sent_at, cm.permit_granted_at) BETWEEN _at - interval '60 days' AND _at
  ), latest AS (
    SELECT max(exposure) AS at FROM activity
  )
  SELECT CASE
    WHEN bool_or(clicked_at BETWEEN _at - interval '30 days' AND _at) THEN NULL
    WHEN count(*) FILTER (WHERE exposure >= latest.at - interval '30 days') >= 6 THEN max(exposure) + interval '30 days'
    WHEN count(*) FILTER (WHERE exposure >= latest.at - interval '14 days') >= 3 THEN max(exposure) + interval '14 days'
  END FROM activity CROSS JOIN latest;
$$;
REVOKE ALL ON FUNCTION public.recipient_fatigue_until(text,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recipient_fatigue_until(text,uuid,timestamptz) TO service_role;

CREATE TABLE public.recipient_mailbox_holds (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  until_at timestamptz NOT NULL
);
ALTER TABLE public.recipient_mailbox_holds ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.recipient_mailbox_holds TO service_role;

CREATE FUNCTION public.record_mailbox_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.occurred_at > clock_timestamp() + interval '5 minutes'
     OR NEW.occurred_at + interval '336 hours' <= clock_timestamp() THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.recipient_mailbox_holds AS h (email_md5, until_at)
  VALUES (md5(lower(btrim(NEW.recipient))), NEW.occurred_at + interval '336 hours')
  ON CONFLICT (email_md5) DO UPDATE SET until_at = EXCLUDED.until_at
    WHERE h.until_at <= NEW.occurred_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_mailbox_hold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mailbox_hold() TO service_role;

CREATE TRIGGER delivery_event_mailbox_hold
  AFTER INSERT ON public.delivery_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'deferred' AND NEW.smtp_code = 452 AND NEW.detail ~ '^4[.]2[.]2([^0-9.]|$)')
  EXECUTE FUNCTION public.record_mailbox_hold();

CREATE TABLE public.subscription_confirmations (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  email_md5 text NOT NULL CHECK (email_md5 ~ '^[0-9a-f]{32}$'),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  proof_payload text,
  proof_signature text,
  CONSTRAINT subscription_proof_pair CHECK (
    (proof_payload IS NULL AND proof_signature IS NULL)
    OR (proof_payload IS NOT NULL AND octet_length(proof_payload) <= 8192
        AND proof_signature IS NOT NULL AND proof_signature ~ '^[0-9a-f]{64}$')
  )
);
ALTER TABLE public.subscription_confirmations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.subscription_confirmations TO service_role;
CREATE INDEX subscription_confirmations_lookup
  ON public.subscription_confirmations (list_id, email_md5, confirmed_at DESC);

CREATE FUNCTION public.confirm_contact_subscription(_list uuid, _email text, _token_hash text, _proof_payload text DEFAULT NULL, _proof_signature text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  address text := lower(btrim(_email));
  recipient text := md5(address);
BEGIN
  PERFORM 1 FROM public.contact_lists WHERE id = _list AND quarantined_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5 = recipient) OR EXISTS (
    SELECT 1 FROM public.contacts WHERE list_id = _list AND email_md5 = recipient AND status <> 'active'
  ) THEN RETURN 'unavailable'; END IF;
  INSERT INTO public.subscription_confirmations (token_hash, list_id, email_md5, proof_payload, proof_signature)
  VALUES (_token_hash, _list, recipient, _proof_payload, _proof_signature) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'confirmed'; END IF;
  INSERT INTO public.contacts (list_id, email)
  SELECT _list, address WHERE NOT EXISTS (SELECT 1 FROM public.contacts WHERE list_id = _list AND email_md5 = recipient)
  ON CONFLICT (list_id, email) DO NOTHING;
  RETURN 'confirmed';
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_contact_subscription(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_contact_subscription(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.read_contact_subscription_proofs(_list uuid, _email text)
RETURNS TABLE (token_hash text, confirmed_at timestamptz, proof_payload text, proof_signature text)
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT token_hash, confirmed_at, proof_payload, proof_signature
  FROM public.subscription_confirmations
  WHERE list_id = _list AND email_md5 = md5(lower(btrim(_email)))
  ORDER BY confirmed_at DESC LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.read_contact_subscription_proofs(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contact_subscription_proofs(uuid,text) TO service_role;

CREATE TABLE public.campaign_placement_monitors (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  test_campaign_id uuid NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  server_id uuid NOT NULL,
  placement_id text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  seeds jsonb NOT NULL,
  observed_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE public.campaign_placement_monitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_placement_monitors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campaign_placement_monitors TO service_role;

CREATE FUNCTION public.start_campaign_placement_monitor(
  _campaign uuid, _server uuid, _placement text, _token text, _expires timestamptz, _seeds jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  source public.campaigns%ROWTYPE;
  test_id uuid;
  addresses text[];
BEGIN
  SELECT * INTO STRICT source FROM public.campaigns WHERE id = _campaign FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.campaign_placement_monitors WHERE campaign_id = _campaign) THEN RETURN; END IF;
  IF source.status = 'cancelled' OR NOT (_server = ANY(source.server_ids))
    OR NOT EXISTS (SELECT 1 FROM public.server_agents WHERE server_id = _server)
    OR _expires <= now() OR _token !~ '^ED-[A-Z0-9]{5,32}$' THEN
    RAISE EXCEPTION 'Campaign or placement test unavailable';
  END IF;
  SELECT array_agg(DISTINCT lower(seed->>'address')) INTO addresses
  FROM jsonb_array_elements(_seeds) AS seeds(seed);
  IF coalesce(cardinality(addresses), 0) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid placement seed count';
  END IF;
  INSERT INTO public.campaigns (
    name, from_name, from_email, reply_to, subject, html, amp_html,
    server_ids, vmta_pool_id, status, total, created_by
  ) VALUES (
    'Test Inbox ' || _token, source.from_name, source.from_email, source.reply_to,
    source.subject || ' [' || _token || ']', source.html, source.amp_html,
    ARRAY[_server], source.vmta_pool_id, 'queued', cardinality(addresses), source.created_by
  ) RETURNING id INTO test_id;
  INSERT INTO public.campaign_messages (campaign_id, server_id, email)
  SELECT test_id, _server, address FROM unnest(addresses) AS address;
  INSERT INTO public.campaign_placement_monitors (campaign_id, test_campaign_id, server_id, placement_id, expires_at, seeds)
  VALUES (_campaign, test_id, _server, _placement, _expires, _seeds);
END;
$$;

CREATE FUNCTION public.read_campaign_delivery_by_domain(_campaign uuid)
RETURNS TABLE (
  domain text, queued bigint, claimed bigint, injected bigint, injection_failed bigint,
  accepted bigint, deferred bigint, bounced bigint, complained bigint, oldest_due_at timestamptz
) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT lower(split_part(m.email, '@', 2)),
    count(*) FILTER (WHERE m.status = 'queued'),
    count(*) FILTER (WHERE m.status = 'claimed'),
    count(*) FILTER (WHERE m.status = 'sent'),
    count(*) FILTER (WHERE m.status = 'failed'),
    count(*) FILTER (WHERE m.delivery_state = 'delivered'),
    count(*) FILTER (WHERE m.delivery_state = 'deferred'),
    count(*) FILTER (WHERE m.delivery_state = 'bounced'),
    count(*) FILTER (WHERE m.delivery_state = 'complained'),
    min(greatest(m.created_at, m.available_at, c.scheduled_at))
      FILTER (WHERE m.status = 'queued' AND greatest(m.created_at, m.available_at, c.scheduled_at) <= now())
  FROM public.campaign_messages m JOIN public.campaigns c ON c.id = m.campaign_id
  WHERE m.campaign_id = _campaign GROUP BY 1;
$$;
REVOKE ALL ON FUNCTION public.start_campaign_placement_monitor(uuid,uuid,text,text,timestamptz,jsonb),
  public.read_campaign_delivery_by_domain(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_campaign_placement_monitor(uuid,uuid,text,text,timestamptz,jsonb),
  public.read_campaign_delivery_by_domain(uuid) TO service_role;

ALTER TABLE public.campaign_messages ADD COLUMN injection_uncertain_at timestamptz;
CREATE INDEX campaign_messages_uncertain_injection ON public.campaign_messages(injection_uncertain_at DESC)
  WHERE injection_uncertain_at IS NOT NULL;
CREATE INDEX campaign_messages_claim_expiry ON public.campaign_messages(server_id,claimed_at,id)
  WHERE status='claimed';

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
   SELECT cm.id FROM public.campaign_messages cm
   JOIN public.campaigns c ON c.id=cm.campaign_id
   WHERE cm.server_id=_server AND public.campaign_can_claim(c,_server)
     AND (cm.available_at IS NULL OR cm.available_at <= now())
     AND cm.status='queued'
     AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(lower(btrim(cm.email))))
   ORDER BY cm.created_at,cm.id
   LIMIT GREATEST(0,LEAST(_limit,500))
   FOR UPDATE OF c,cm SKIP LOCKED
 )
 RETURNING *;
END;
$$;

CREATE FUNCTION public.reconcile_campaign_injections(_server uuid, _receipts jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  repaired integer;
  repaired_campaign_ids uuid[];
BEGIN
  WITH updated AS (
    UPDATE public.campaign_messages cm SET
      status='sent', sent_at=coalesce(cm.sent_at, receipt."occurredAt"), injection_uncertain_at=NULL, error=NULL
    FROM jsonb_to_recordset(_receipts) AS receipt("messageId" uuid, recipient text, "occurredAt" timestamptz)
    WHERE cm.server_id=_server AND cm.id=receipt."messageId"
      AND lower(btrim(cm.email))=lower(btrim(receipt.recipient))
      AND receipt."occurredAt" >= cm.created_at - interval '1 second'
      AND receipt."occurredAt" <= now() + interval '5 minutes'
      AND (cm.status='claimed' OR cm.injection_uncertain_at IS NOT NULL
        OR (cm.status='failed' AND cm.error='Injection KumoMTA non confirmée'))
    RETURNING cm.campaign_id
  )
  SELECT count(*), array_agg(DISTINCT campaign_id) INTO repaired,repaired_campaign_ids FROM updated;
  UPDATE public.campaigns SET status='done'
  WHERE id IN (
    SELECT c.id FROM public.campaigns c WHERE c.id=ANY(repaired_campaign_ids) AND c.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
        AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
      )
    FOR UPDATE OF c SKIP LOCKED
  );
  RETURN repaired;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_campaign_injections(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_campaign_injections(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_sunset_contacts(_ids uuid[], _days integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT contact_id FROM public.campaign_messages
  WHERE _days IN (30,60,90,365) AND contact_id = ANY(_ids)
  GROUP BY contact_id
  HAVING min(sent_at) FILTER (WHERE delivery_state = 'delivered') < now() - make_interval(days => _days)
    AND COALESCE(max(GREATEST(opened_at, clicked_at)), '-infinity'::timestamptz) < now() - make_interval(days => _days);
$$;

CREATE TABLE public.campaign_frequency_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hours integer NOT NULL DEFAULT 0 CHECK (hours IN (0,24,48))
);
INSERT INTO public.campaign_frequency_policy DEFAULT VALUES;
ALTER TABLE public.campaign_frequency_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_frequency_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.campaign_frequency_policy TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_can_claim(_campaign public.campaigns, _server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT _campaign.status='queued' AND _campaign.auto_pause_reason IS NULL
   AND (_campaign.scheduled_at IS NULL OR _campaign.scheduled_at <= now())
   AND NOT EXISTS (
     SELECT 1 FROM public.contact_lists
     WHERE id=_campaign.list_id AND quarantined_at IS NOT NULL
   )
   AND EXISTS (
     SELECT 1 FROM public.server_agents agent
     WHERE agent.server_id=_server
     AND (NOT (_campaign.weekly_digest OR _campaign.fatigue_protection OR (_campaign.list_id IS NOT NULL AND (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) > 0)) OR agent.metrics->>'preferencePermit' = 'true')
     AND CASE
       WHEN agent.metrics->>'vmtaRouting' = 'true'
        AND substring(agent.kumo_version FROM '^kumod ([0-9]{4}\.[0-9]{2}\.[0-9]{2})') >= '2026.09.29'
       THEN agent.status='online' AND agent.vmta_config_hash IS NOT NULL
        AND agent.applied_hash=agent.vmta_config_hash
        AND EXISTS (
          SELECT 1 FROM public.server_ips ip
          LEFT JOIN public.vmta_pools pool ON pool.id=ip.pool_id
          WHERE ip.server_id=_server AND ip.active AND ip.family=4 AND ip.quarantined_at IS NULL
          AND (
            (_campaign.vmta_pool_id IS NULL AND ip.pool_id IS NULL)
            OR (pool.purpose='marketing' AND pool.status='active'
                AND (_campaign.vmta_pool_id IS NULL OR pool.id=_campaign.vmta_pool_id))
          )
        )
       ELSE false
     END
   );
$$;

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
  campaign_id_for_message uuid;
  campaign_topic text;
  allowed_topics text[];
  snoozed_until timestamptz;
  wants_digest boolean;
  is_digest boolean;
  fatigue_until timestamptz;
  mailbox_hold_until timestamptz;
  previous_permit timestamptz;
  cap_hours integer;
  previous_activity timestamptz;
  checked_at timestamptz;
BEGIN
  SELECT md5(lower(btrim(cm.email))), cm.campaign_id INTO recipient, campaign_id_for_message
    FROM public.campaign_messages cm WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed';
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  SELECT p.topics INTO allowed_topics FROM public.recipient_topic_preferences p WHERE p.email_md5 = recipient;
  SELECT p.until_at INTO snoozed_until FROM public.recipient_snoozes p WHERE p.email_md5 = recipient;
  SELECT EXISTS (SELECT 1 FROM public.recipient_digest_preferences p WHERE p.email_md5 = recipient) INTO wants_digest;
  SELECT public.recipient_fatigue_until(recipient, _id, clock_timestamp()) INTO fatigue_until
    FROM public.campaigns c WHERE c.id = campaign_id_for_message AND c.fatigue_protection AND NOT c.weekly_digest;
  SELECT h.until_at INTO mailbox_hold_until FROM public.recipient_mailbox_holds h WHERE h.email_md5 = recipient;

  PERFORM 1 FROM public.campaigns c
    WHERE c.id = campaign_id_for_message AND (c.weekly_digest <> wants_digest OR NOT (c.topic = ANY(allowed_topics)) OR snoozed_until > clock_timestamp() OR fatigue_until > clock_timestamp() OR mailbox_hold_until > clock_timestamp())
    FOR NO KEY UPDATE OF c;
  checked_at := clock_timestamp();

  SELECT cm.permit_granted_at, c.topic, c.weekly_digest, CASE WHEN c.list_id IS NOT NULL THEN (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) ELSE 0 END INTO previous_permit, campaign_topic, is_digest, cap_hours
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= checked_at - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= checked_at)
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient)
    FOR UPDATE OF cm;
  IF NOT FOUND THEN RETURN false; END IF;

  IF is_digest <> wants_digest OR snoozed_until > checked_at OR fatigue_until > checked_at OR mailbox_hold_until > checked_at OR NOT (campaign_topic = ANY(allowed_topics)) THEN
    UPDATE public.campaign_messages SET status = 'failed',
      error = CASE WHEN snoozed_until > checked_at THEN 'Envois en pause a la demande du destinataire'
        WHEN mailbox_hold_until > checked_at THEN 'Boîte pleine, suspension temporaire des campagnes'
        WHEN fatigue_until > checked_at THEN 'Cadence de protection du destinataire'
        WHEN is_digest <> wants_digest THEN 'Format non choisi dans les preferences'
        ELSE 'Thème non choisi dans les préférences' END
      WHERE id = _id;
    UPDATE public.campaigns c SET status = 'done'
      WHERE c.id = campaign_id_for_message AND c.status = 'queued' AND NOT EXISTS (
        SELECT 1 FROM public.campaign_messages cm WHERE cm.campaign_id = c.id AND cm.status IN ('queued','claimed')
      );
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = recipient) THEN
    IF previous_permit IS NOT NULL THEN
      UPDATE public.campaign_messages SET status = 'failed', error = 'Envoi hebdomadaire déjà autorisé, résultat non confirmé'
        WHERE id = _id;
      RETURN false;
    END IF;
    SELECT GREATEST(cm.sent_at, cm.permit_granted_at) INTO previous_activity
      FROM public.campaign_messages cm
      WHERE md5(lower(btrim(cm.email))) = recipient AND (cm.sent_at IS NOT NULL OR cm.permit_granted_at IS NOT NULL)
      ORDER BY GREATEST(cm.sent_at, cm.permit_granted_at) DESC LIMIT 1;
    IF previous_activity + interval '168 hours' > checked_at THEN
      UPDATE public.campaign_messages SET status = 'queued', claimed_at = NULL,
        available_at = previous_activity + interval '168 hours'
        WHERE id = _id;
      RETURN false;
    END IF;
  END IF;

  IF cap_hours > 0 THEN
    IF previous_permit IS NOT NULL THEN RETURN false; END IF;
    SELECT greatest(cm.sent_at, cm.permit_granted_at) INTO previous_activity
    FROM public.campaign_messages cm
    WHERE cm.id <> _id AND md5(lower(btrim(cm.email))) = recipient
      AND (cm.sent_at IS NOT NULL OR cm.permit_granted_at IS NOT NULL)
      AND greatest(cm.sent_at, cm.permit_granted_at) > checked_at - make_interval(hours => cap_hours)
    ORDER BY greatest(cm.sent_at, cm.permit_granted_at) DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.campaign_messages SET status='queued', claimed_at=NULL,
        available_at=previous_activity + make_interval(hours => cap_hours)
      WHERE id=_id;
      RETURN false;
    END IF;
  END IF;

  UPDATE public.campaign_messages SET permit_granted_at = checked_at WHERE id = _id;
  RETURN true;
END;
$$;