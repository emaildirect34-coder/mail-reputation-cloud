ALTER TABLE public.campaign_messages ADD COLUMN verified_click_id text;
CREATE UNIQUE INDEX campaign_messages_verified_click_id
  ON public.campaign_messages(verified_click_id) WHERE verified_click_id IS NOT NULL;

CREATE FUNCTION public.register_verified_campaign_click(_id uuid)
RETURNS text LANGUAGE sql SET search_path=public AS $$
  UPDATE public.campaign_messages
  SET verified_click_id=COALESCE(verified_click_id,encode(extensions.gen_random_bytes(18),'hex')),
      clicked_at=COALESCE(clicked_at,now()),
      opened_at=COALESCE(opened_at,now())
  WHERE id=_id
  RETURNING verified_click_id;
$$;
REVOKE ALL ON FUNCTION public.register_verified_campaign_click(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_verified_campaign_click(uuid) TO service_role;

CREATE FUNCTION public.unsubscribe_campaign_message(_token text, _server uuid DEFAULT NULL)
RETURNS TABLE(email text, campaign_id uuid, newly_suppressed boolean)
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  message public.campaign_messages%ROWTYPE;
  address_md5 text;
  inserted integer;
BEGIN
  SELECT m.* INTO message FROM public.campaign_messages m
  WHERE m.unsub_token=_token AND (_server IS NULL OR m.server_id=_server);
  IF NOT FOUND THEN RETURN; END IF;
  address_md5 := md5(lower(btrim(message.email)));
  INSERT INTO public.suppressions(email_md5,reason,source)
  VALUES(address_md5,'unsubscribe','campagne ' || message.campaign_id)
  ON CONFLICT (email_md5) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  UPDATE public.contacts SET status='unsubscribed'
  WHERE email_md5=address_md5 AND status='active';
  RETURN QUERY SELECT message.email,message.campaign_id,inserted=1;
END;
$$;
REVOKE ALL ON FUNCTION public.unsubscribe_campaign_message(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_campaign_message(text,uuid) TO service_role;

CREATE FUNCTION public.record_sponsor_postback(
  _account uuid, _campaign uuid, _offer uuid, _external_id text, _currency text,
  _amount bigint, _status text, _description text, _by uuid
)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  inserted integer;
BEGIN
  INSERT INTO public.finance_entries(
    account_id,campaign_id,offer_id,external_id,kind,status,amount_cents,currency,
    category,description,occurred_on,source,created_by
  )
  SELECT _account,_campaign,_offer,_external_id,'revenue',_status,_amount,_currency,
         'Conversion',_description,(now() AT TIME ZONE 'UTC')::date,'api',_by
  WHERE _offer IS NOT NULL
  ON CONFLICT (account_id,external_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;

  IF inserted=0 THEN
    UPDATE public.finance_entries
    SET status=_status,amount_cents=_amount,currency=_currency
    WHERE account_id=_account AND external_id=_external_id AND campaign_id=_campaign
      AND kind='revenue' AND source='api';
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  UPDATE public.sponsor_postbacks
  SET hits=hits+inserted,last_at=now()
  WHERE account_id=_account;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_sponsor_postback(uuid,uuid,uuid,text,text,bigint,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sponsor_postback(uuid,uuid,uuid,text,text,bigint,text,text,uuid) TO service_role;

CREATE TABLE public.recipient_weekly_preferences (
  email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$')
);
ALTER TABLE public.recipient_weekly_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.recipient_weekly_preferences TO service_role;

ALTER TABLE public.campaign_messages ADD COLUMN permit_granted_at timestamptz;
CREATE INDEX campaign_messages_recipient_activity
  ON public.campaign_messages (md5(lower(btrim(email))), GREATEST(sent_at, permit_granted_at) DESC)
  WHERE sent_at IS NOT NULL OR permit_granted_at IS NOT NULL;

CREATE FUNCTION public.read_recipient_preferences(_token text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'brand', c.from_name,
    'weekly', EXISTS (
      SELECT 1 FROM public.recipient_weekly_preferences p WHERE p.email_md5 = md5(lower(btrim(cm.email)))
    ),
    'suppressed', EXISTS (
      SELECT 1 FROM public.suppressions s WHERE s.email_md5 = md5(lower(btrim(cm.email)))
    )
  )
  FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
  WHERE cm.unsub_token = _token;
$$;

CREATE FUNCTION public.set_recipient_preferences(_token text, _weekly boolean)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  IF _weekly IS NULL THEN RETURN 'invalid'; END IF;
  SELECT md5(lower(btrim(cm.email))) INTO recipient FROM public.campaign_messages cm WHERE cm.unsub_token = _token;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient) THEN RETURN 'suppressed'; END IF;

  IF _weekly THEN
    INSERT INTO public.recipient_weekly_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.recipient_weekly_preferences p WHERE p.email_md5 = recipient;
  END IF;
  RETURN 'saved';
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_may_inject(_server uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  recipient text;
  previous_permit timestamptz;
  previous_activity timestamptz;
  checked_at timestamptz;
BEGIN
  SELECT md5(lower(btrim(cm.email))) INTO recipient
    FROM public.campaign_messages cm WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed';
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient, 29029));
  checked_at := clock_timestamp();

  SELECT cm.permit_granted_at INTO previous_permit
    FROM public.campaign_messages cm JOIN public.campaigns c ON c.id = cm.campaign_id
    WHERE cm.id = _id AND cm.server_id = _server AND cm.status = 'claimed'
      AND cm.claimed_at >= checked_at - interval '15 minutes'
      AND (cm.available_at IS NULL OR cm.available_at <= checked_at)
      AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5 = recipient)
    FOR UPDATE OF cm;
  IF NOT FOUND THEN RETURN false; END IF;

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

  UPDATE public.campaign_messages SET permit_granted_at = checked_at WHERE id = _id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.read_recipient_preferences(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_recipient_preferences(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_recipient_preferences(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_recipient_preferences(text,boolean) TO service_role;

ALTER TABLE public.campaigns
  ADD COLUMN amp_html text,
  ADD CONSTRAINT campaigns_amp_html_size
    CHECK (amp_html IS NULL OR octet_length(amp_html) BETWEEN 1 AND 200000);