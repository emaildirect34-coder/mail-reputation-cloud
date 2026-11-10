BEGIN;
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
COMMIT;
