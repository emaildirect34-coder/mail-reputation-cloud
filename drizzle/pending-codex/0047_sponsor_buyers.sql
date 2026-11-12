BEGIN;

ALTER TABLE public.campaigns ADD COLUMN purchase_thank_you boolean NOT NULL DEFAULT false;
ALTER TABLE public.finance_entries ADD COLUMN postback_message_id uuid REFERENCES public.campaign_messages(id) ON DELETE SET NULL;

CREATE TABLE public.sponsor_purchase_settings (
  offer_id uuid PRIMARY KEY REFERENCES public.sponsor_offers(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 100),
  thank_you_enabled boolean NOT NULL DEFAULT false,
  review_url text,
  consent_list_id uuid REFERENCES public.contact_lists(id) ON DELETE SET NULL
);

CREATE TABLE public.sponsor_purchases (
  finance_id uuid PRIMARY KEY REFERENCES public.finance_entries(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.sponsor_offers(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected')),
  approved_at timestamptz,
  thank_you_message_id uuid UNIQUE REFERENCES public.campaign_messages(id) ON DELETE SET NULL,
  feedback_hash text UNIQUE CHECK (feedback_hash ~ '^[a-f0-9]{64}$'),
  consent_at timestamptz,
  consent_list_id uuid REFERENCES public.contact_lists(id) ON DELETE SET NULL,
  consent_topics text[],
  consent_weekly boolean,
  consent_statement text
);
CREATE INDEX sponsor_purchases_approved ON public.sponsor_purchases(offer_id, approved_at DESC)
  WHERE status='approved';
ALTER TABLE public.sponsor_purchase_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_purchase_settings,public.sponsor_purchases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sponsor_purchase_settings TO service_role;

CREATE FUNCTION public.record_sponsor_purchase_postback(
  _account uuid, _campaign uuid, _offer uuid, _external_id text, _currency text,
  _amount bigint, _status text, _description text, _by uuid, _click_id text,
  _event text, _purchase_status text, _public_origin text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  purchase public.sponsor_purchases;
  settings public.sponsor_purchase_settings;
  source_message public.campaign_messages;
  source_campaign public.campaigns;
  attributed_message uuid;
  previous_finance_status text;
  entry_id uuid;
  thank_campaign uuid;
  thank_message uuid;
  feedback_token text;
  feedback_url text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_account::text || ':' || _external_id, 47047));
  SELECT p.* INTO purchase FROM public.sponsor_purchases p
    JOIN public.finance_entries f ON f.id=p.finance_id
    WHERE f.account_id=_account AND f.external_id=_external_id;
  SELECT m.* INTO source_message FROM public.campaign_messages m
    WHERE m.campaign_id=_campaign AND m.verified_click_id=_click_id;
  SELECT postback_message_id,status INTO attributed_message,previous_finance_status FROM public.finance_entries
    WHERE account_id=_account AND external_id=_external_id;
  IF attributed_message IS NOT NULL AND attributed_message IS DISTINCT FROM source_message.id THEN RETURN false; END IF;
  IF attributed_message IS NOT NULL AND previous_finance_status='rejected'
     AND _event IS NOT NULL AND _purchase_status='approved' THEN RETURN true; END IF;
  IF purchase.finance_id IS NOT NULL THEN
    IF purchase.source_message_id IS DISTINCT FROM source_message.id THEN RETURN false; END IF;
    IF purchase.status='rejected' AND _purchase_status IS DISTINCT FROM 'rejected' THEN RETURN true; END IF;
    IF purchase.status='approved' AND _purchase_status IS DISTINCT FROM 'rejected'
       AND (_purchase_status IS DISTINCT FROM 'approved' OR _status <> 'approved') THEN RETURN true; END IF;
  END IF;

  IF NOT public.record_sponsor_postback(_account,_campaign,_offer,_external_id,_currency,_amount,_status,_description,_by)
    THEN RETURN false;
  END IF;
  IF source_message.id IS NOT NULL THEN
    UPDATE public.finance_entries SET postback_message_id=source_message.id
      WHERE account_id=_account AND external_id=_external_id AND postback_message_id IS NULL;
  END IF;
  IF purchase.finance_id IS NOT NULL AND _purchase_status='rejected' THEN
    UPDATE public.sponsor_purchases SET status='rejected' WHERE finance_id=purchase.finance_id;
    SELECT campaign_id INTO thank_campaign FROM public.campaign_messages WHERE id=purchase.thank_you_message_id;
    PERFORM 1 FROM public.campaigns WHERE id=thank_campaign FOR NO KEY UPDATE;
    UPDATE public.campaign_messages SET status='failed', error='Achat annulé avant injection'
      WHERE id=purchase.thank_you_message_id AND status IN ('queued','claimed') AND permit_granted_at IS NULL;
    IF FOUND THEN UPDATE public.campaigns SET status='cancelled' WHERE id=thank_campaign; END IF;
    RETURN true;
  END IF;

  IF source_message.id IS NULL OR _purchase_status IS NULL OR _offer IS NULL THEN RETURN true; END IF;
  SELECT s.* INTO settings FROM public.sponsor_purchase_settings s
    JOIN public.sponsor_offers o ON o.id=s.offer_id
    WHERE s.offer_id=_offer AND o.account_id=_account AND s.event_key=_event;
  IF NOT FOUND THEN RETURN true; END IF;
  SELECT * INTO source_campaign FROM public.campaigns WHERE id=_campaign AND sponsor_offer_id=_offer;
  IF NOT FOUND THEN RETURN true; END IF;
  SELECT id INTO entry_id FROM public.finance_entries WHERE account_id=_account AND external_id=_external_id;
  IF purchase.finance_id IS NULL THEN
    INSERT INTO public.sponsor_purchases(finance_id,source_message_id,offer_id,status)
      VALUES (entry_id,source_message.id,_offer,_purchase_status);
  END IF;
  IF _purchase_status <> 'approved' OR purchase.approved_at IS NOT NULL THEN RETURN true; END IF;
  UPDATE public.sponsor_purchases SET status='approved', approved_at=now() WHERE finance_id=entry_id;

  IF NOT settings.thank_you_enabled
    OR EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5=md5(lower(btrim(source_message.email))))
    THEN RETURN true;
  END IF;
  IF _public_origin IS NULL OR _public_origin !~ '^https://[a-z0-9.-]+(:[0-9]+)?$'
    THEN RAISE EXCEPTION 'Invalid purchase public origin'; END IF;

  feedback_token := encode(extensions.gen_random_bytes(24),'hex');
  feedback_url := _public_origin || '/apres-achat/' || feedback_token;
  INSERT INTO public.campaigns(name,from_name,from_email,reply_to,subject,html,server_ids,vmta_pool_id,status,total,created_by,purchase_thank_you)
    VALUES ('Remerciement après achat',source_campaign.from_name,source_campaign.from_email,source_campaign.reply_to,
      'Merci pour votre achat',
      '<p>Bonjour,</p><p>Merci pour votre achat auprès de notre partenaire.</p>'
      || '<p>Vous pouvez nous dire comment il s’est passé et choisir si vous souhaitez recevoir nos prochaines offres.</p>'
      || '<p><a href="' || feedback_url || '">Donner mon avis et choisir mes préférences</a></p>',
      ARRAY[source_message.server_id],source_campaign.vmta_pool_id,'queued',1,_by,true)
    RETURNING id INTO thank_campaign;
  INSERT INTO public.campaign_messages(campaign_id,email,server_id)
    VALUES (thank_campaign,source_message.email,source_message.server_id) RETURNING id INTO thank_message;
  UPDATE public.sponsor_purchases SET thank_you_message_id=thank_message,
    feedback_hash=encode(sha256(convert_to(feedback_token,'UTF8')),'hex') WHERE finance_id=entry_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.read_sponsor_buyers(_offer uuid,_offset integer)
RETURNS TABLE(email text, purchases bigint, last_purchase_at timestamptz, subscribed boolean, thank_you_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT lower(btrim(m.email)), count(*), max(p.approved_at),
    bool_or(p.consent_at IS NOT NULL AND s.email_md5 IS NULL AND EXISTS (
      SELECT 1 FROM public.contacts subscriber
      WHERE subscriber.list_id=p.consent_list_id
        AND subscriber.email_md5=md5(lower(btrim(m.email))) AND subscriber.status='active'
    )),
    (array_agg(coalesce(t.status,'not_queued') ORDER BY p.approved_at DESC,p.finance_id DESC))[1]
  FROM public.sponsor_purchases p JOIN public.campaign_messages m ON m.id=p.source_message_id
  LEFT JOIN public.campaign_messages t ON t.id=p.thank_you_message_id
  LEFT JOIN public.suppressions s ON s.email_md5=md5(lower(btrim(m.email)))
  WHERE p.offer_id=_offer AND p.status='approved'
  GROUP BY lower(btrim(m.email))
  ORDER BY max(p.approved_at) DESC, lower(btrim(m.email))
  LIMIT 50 OFFSET greatest(_offset,0);
$$;

CREATE FUNCTION public.read_purchase_feedback(_hash text)
RETURNS TABLE(review_url text, can_subscribe boolean, confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT s.review_url, l.id IS NOT NULL AND sup.email_md5 IS NULL, p.consent_at IS NOT NULL
  FROM public.sponsor_purchases p
  JOIN public.campaign_messages m ON m.id=p.source_message_id
  LEFT JOIN public.sponsor_purchase_settings s ON s.offer_id=p.offer_id
  LEFT JOIN public.contact_lists l ON l.id=s.consent_list_id AND l.quarantined_at IS NULL
  LEFT JOIN public.suppressions sup ON sup.email_md5=md5(lower(btrim(m.email)))
  WHERE p.feedback_hash=_hash AND p.status='approved' AND p.approved_at > now()-interval '180 days';
$$;

CREATE FUNCTION public.confirm_purchase_offers(_hash text,_topics text[],_weekly boolean,_statement text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  purchase public.sponsor_purchases;
  target_list uuid;
  address text;
  recipient text;
BEGIN
  IF _weekly IS NULL OR _statement IS NULL OR length(_statement) NOT BETWEEN 1 AND 500
     OR _topics IS NULL OR cardinality(_topics) NOT BETWEEN 1 AND 4
     OR NOT (_topics <@ ARRAY['news','offers','events','education'])
     OR cardinality(_topics) <> (SELECT count(DISTINCT topic) FROM unnest(_topics) topic)
    THEN RETURN 'invalid';
  END IF;
  SELECT * INTO purchase FROM public.sponsor_purchases
    WHERE feedback_hash=_hash AND status='approved' AND approved_at > now()-interval '180 days' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF purchase.consent_at IS NOT NULL THEN RETURN 'confirmed'; END IF;
  SELECT consent_list_id INTO target_list FROM public.sponsor_purchase_settings WHERE offer_id=purchase.offer_id;
  SELECT lower(btrim(email)) INTO address FROM public.campaign_messages WHERE id=purchase.source_message_id;
  recipient := md5(address);
  IF target_list IS NULL OR recipient IS NULL THEN RETURN 'unavailable'; END IF;
  IF public.confirm_contact_subscription(target_list,address,_hash) <> 'confirmed' THEN RETURN 'unavailable'; END IF;

  INSERT INTO public.recipient_topic_preferences(email_md5,topics) VALUES (recipient,_topics)
    ON CONFLICT (email_md5) DO UPDATE SET topics=EXCLUDED.topics;
  IF _weekly THEN
    INSERT INTO public.recipient_weekly_preferences(email_md5) VALUES (recipient) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.recipient_weekly_preferences WHERE email_md5=recipient;
  END IF;
  DELETE FROM public.recipient_digest_preferences WHERE email_md5=recipient;
  UPDATE public.sponsor_purchases SET consent_at=now(),consent_list_id=target_list,
    consent_topics=_topics,consent_weekly=_weekly,consent_statement=_statement WHERE finance_id=purchase.finance_id;
  RETURN 'confirmed';
END;
$$;

-- Reuse the marketing permit verbatim. The thank-you has its own single-use
-- permit and still observes global suppressions, mailbox holds and server health.
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
     AND (NOT (_campaign.purchase_thank_you OR _campaign.weekly_digest OR _campaign.fatigue_protection
              OR (_campaign.list_id IS NOT NULL AND (SELECT hours FROM public.campaign_frequency_policy WHERE singleton) > 0))
          OR agent.metrics->>'preferencePermit' = 'true')
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

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_marketing;
REVOKE ALL ON FUNCTION public.agent_may_inject_marketing(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  recipient text;
BEGIN
  SELECT md5(lower(btrim(m.email))) INTO recipient FROM public.campaign_messages m
    JOIN public.campaigns c ON c.id=m.campaign_id
    WHERE m.id=_id AND m.server_id=_server AND c.purchase_thank_you;
  IF NOT FOUND THEN RETURN public.agent_may_inject_marketing(_server,_id); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient,29029));
  UPDATE public.campaign_messages m SET permit_granted_at=clock_timestamp()
    FROM public.campaigns c
    WHERE m.id=_id AND m.server_id=_server AND c.id=m.campaign_id
      AND m.status='claimed' AND m.claimed_at >= clock_timestamp()-interval '15 minutes'
      AND m.permit_granted_at IS NULL AND public.campaign_can_claim(c,_server)
      AND NOT EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5=recipient)
      AND NOT EXISTS (SELECT 1 FROM public.recipient_mailbox_holds WHERE email_md5=recipient AND until_at > clock_timestamp())
      AND EXISTS (SELECT 1 FROM public.sponsor_purchases WHERE thank_you_message_id=m.id AND status='approved');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sponsor_purchase_postback(uuid,uuid,uuid,text,text,bigint,text,text,uuid,text,text,text,text),
  public.read_sponsor_buyers(uuid,integer), public.read_purchase_feedback(text),
  public.confirm_purchase_offers(text,text[],boolean,text), public.agent_may_inject(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sponsor_purchase_postback(uuid,uuid,uuid,text,text,bigint,text,text,uuid,text,text,text,text),
  public.read_sponsor_buyers(uuid,integer), public.read_purchase_feedback(text),
  public.confirm_purchase_offers(text,text[],boolean,text), public.agent_may_inject(uuid,uuid)
  TO service_role;
COMMIT;
