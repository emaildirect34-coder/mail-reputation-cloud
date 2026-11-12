BEGIN;

CREATE TABLE public.sponsor_brands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED UNIQUE
);
ALTER TABLE public.sponsor_offers ADD COLUMN brand_id uuid REFERENCES public.sponsor_brands(id);
ALTER TABLE public.campaigns ADD COLUMN sponsor_brand_id uuid REFERENCES public.sponsor_brands(id);
CREATE TABLE public.recipient_sponsor_blocks (
 recipient_md5 text NOT NULL CHECK (recipient_md5 ~ '^[a-f0-9]{32}$'),
 brand_id uuid NOT NULL REFERENCES public.sponsor_brands(id),
 blocked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (recipient_md5,brand_id)
);
ALTER TABLE public.sponsor_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipient_sponsor_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_brands,public.recipient_sponsor_blocks FROM PUBLIC,anon,authenticated;
CREATE INDEX campaign_messages_sponsor_history ON public.campaign_messages(md5(lower(btrim(email))),campaign_id)
 WHERE status='sent';

CREATE FUNCTION public.set_sponsor_offer_brand(_offer uuid,_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 brand uuid;
 cleaned text := btrim(_name);
BEGIN
 PERFORM 1 FROM public.sponsor_offers WHERE id=_offer FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF cleaned IS NOT NULL AND cleaned<>'' THEN
   INSERT INTO public.sponsor_brands(name) VALUES (cleaned)
   ON CONFLICT (name_key) DO NOTHING;
   SELECT id INTO brand FROM public.sponsor_brands WHERE name_key=lower(cleaned);
 END IF;
 UPDATE public.sponsor_offers SET brand_id=brand WHERE id=_offer;
 RETURN true;
END;
$$;

CREATE FUNCTION public.read_sponsor_offer_brand(_offer uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT b.name FROM public.sponsor_offers o JOIN public.sponsor_brands b ON b.id=o.brand_id WHERE o.id=_offer
$$;

CREATE FUNCTION public.list_sponsor_brands()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT name FROM public.sponsor_brands ORDER BY name
$$;

CREATE FUNCTION public.snapshot_campaign_sponsor_brand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.sponsor_offer_id IS NOT DISTINCT FROM NEW.sponsor_offer_id THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.sponsor_brand_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT o.brand_id INTO NEW.sponsor_brand_id FROM public.sponsor_offers o WHERE o.id=NEW.sponsor_offer_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER snapshot_campaign_sponsor_brand
BEFORE INSERT OR UPDATE OF sponsor_offer_id ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.snapshot_campaign_sponsor_brand();

CREATE FUNCTION public.sponsor_preference_recipient(_token text,_scope text)
RETURNS TABLE(recipient_md5 text,brand_id uuid) LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT md5(lower(btrim(m.email))),coalesce(c.sponsor_brand_id,o.brand_id)
 FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
 LEFT JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id
 WHERE _scope='campaign' AND m.unsub_token=_token
 UNION ALL
 SELECT md5(lower(btrim(m.email))),coalesce(c.sponsor_brand_id,o.brand_id)
 FROM public.sponsor_purchases p JOIN public.campaign_messages m ON m.id=p.source_message_id
 JOIN public.campaigns c ON c.id=m.campaign_id JOIN public.sponsor_offers o ON o.id=p.offer_id
 WHERE _scope='purchase' AND p.feedback_hash=_token AND p.status='approved'
  AND p.approved_at>now()-interval '180 days'
$$;

CREATE FUNCTION public.read_recipient_sponsor_options(_token text,_scope text)
RETURNS TABLE(id uuid,name text,blocked boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH recipient AS (
   SELECT r.* FROM public.sponsor_preference_recipient(_token,_scope) r
   WHERE NOT EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=r.recipient_md5)
 ), known AS (
   SELECT r.brand_id FROM recipient r
   UNION
   SELECT coalesce(c.sponsor_brand_id,o.brand_id)
   FROM recipient r JOIN public.campaign_messages m ON md5(lower(btrim(m.email)))=r.recipient_md5 AND m.status='sent'
   JOIN public.campaigns c ON c.id=m.campaign_id AND c.sponsor_offer_id IS NOT NULL
   JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id
   UNION
   SELECT b.brand_id FROM recipient r JOIN public.recipient_sponsor_blocks b ON b.recipient_md5=r.recipient_md5
 )
 SELECT brand.id,brand.name,block.brand_id IS NOT NULL
 FROM known k JOIN public.sponsor_brands brand ON brand.id=k.brand_id CROSS JOIN recipient r
 LEFT JOIN public.recipient_sponsor_blocks block ON block.recipient_md5=r.recipient_md5 AND block.brand_id=brand.id
 ORDER BY brand.name,brand.id
$$;

CREATE FUNCTION public.set_recipient_sponsor_option(_token text,_scope text,_brand uuid,_blocked boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 recipient text;
BEGIN
 SELECT r.recipient_md5 INTO recipient FROM public.sponsor_preference_recipient(_token,_scope) r;
 IF recipient IS NULL OR _blocked IS NULL THEN RETURN 'invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(recipient,29029));
 IF EXISTS (SELECT 1 FROM public.suppressions WHERE email_md5=recipient) THEN RETURN 'suppressed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.read_recipient_sponsor_options(_token,_scope) b WHERE b.id=_brand)
 THEN RETURN 'invalid'; END IF;
 IF _blocked THEN
   INSERT INTO public.recipient_sponsor_blocks(recipient_md5,brand_id) VALUES (recipient,_brand) ON CONFLICT DO NOTHING;
 ELSE
   DELETE FROM public.recipient_sponsor_blocks b WHERE b.recipient_md5=recipient AND b.brand_id=_brand;
 END IF;
 RETURN 'saved';
END;
$$;

CREATE FUNCTION public.sponsor_preference_blocked_contacts(_brand uuid,_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id FROM public.contacts c JOIN public.recipient_sponsor_blocks b ON b.recipient_md5=c.email_md5
 WHERE b.brand_id=_brand AND c.id=ANY(_ids)
$$;

ALTER FUNCTION public.agent_may_inject(uuid,uuid) RENAME TO agent_may_inject_before_sponsor_preferences;
REVOKE ALL ON FUNCTION public.agent_may_inject_before_sponsor_preferences(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.agent_may_inject(_server uuid,_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 recipient text;
 campaign uuid;
 brand uuid;
BEGIN
 SELECT md5(lower(btrim(m.email))),c.id,coalesce(c.sponsor_brand_id,o.brand_id)
 INTO recipient,campaign,brand FROM public.campaign_messages m JOIN public.campaigns c ON c.id=m.campaign_id
 LEFT JOIN public.sponsor_offers o ON o.id=c.sponsor_offer_id
 WHERE m.id=_id AND m.server_id=_server AND m.status='claimed';
 IF NOT FOUND THEN RETURN false; END IF;
 IF brand IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(recipient,29029));
   IF EXISTS (SELECT 1 FROM public.recipient_sponsor_blocks b WHERE b.recipient_md5=recipient AND b.brand_id=brand) THEN
     PERFORM 1 FROM public.campaigns c WHERE c.id=campaign FOR NO KEY UPDATE;
     UPDATE public.campaign_messages m SET status='skipped',error='Marque exclue dans les préférences du destinataire'
     WHERE m.id=_id AND m.server_id=_server AND m.status='claimed' AND m.permit_granted_at IS NULL;
     IF FOUND THEN
       UPDATE public.campaigns c SET suppressed=c.suppressed+1,
         status=CASE WHEN c.status='queued' AND NOT EXISTS (
           SELECT 1 FROM public.campaign_messages m WHERE m.campaign_id=c.id
             AND (m.status IN ('queued','claimed') OR m.injection_uncertain_at IS NOT NULL)
         ) THEN 'done' ELSE c.status END
       WHERE c.id=campaign;
     END IF;
     RETURN false;
   END IF;
 END IF;
 RETURN public.agent_may_inject_before_sponsor_preferences(_server,_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sponsor_preference_recipient(text,text),public.snapshot_campaign_sponsor_brand()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_sponsor_offer_brand(uuid,text),public.read_sponsor_offer_brand(uuid),
 public.list_sponsor_brands(),
 public.read_recipient_sponsor_options(text,text),public.set_recipient_sponsor_option(text,text,uuid,boolean),
 public.sponsor_preference_blocked_contacts(uuid,uuid[]),public.agent_may_inject(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_sponsor_offer_brand(uuid,text),public.read_sponsor_offer_brand(uuid),
 public.list_sponsor_brands(),
 public.read_recipient_sponsor_options(text,text),public.set_recipient_sponsor_option(text,text,uuid,boolean),
 public.sponsor_preference_blocked_contacts(uuid,uuid[]),public.agent_may_inject(uuid,uuid)
 TO service_role;
COMMIT;
