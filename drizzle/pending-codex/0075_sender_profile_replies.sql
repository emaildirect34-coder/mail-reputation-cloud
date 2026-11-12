BEGIN;

CREATE TABLE public.sender_reply_channels (
  profile_id uuid PRIMARY KEY REFERENCES public.sender_profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.sender_profile_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.sender_profiles(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.campaign_messages(id) ON DELETE CASCADE,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL,
  handled_at timestamptz,
  UNIQUE (profile_id,source_hash)
);
CREATE INDEX sender_profile_replies_queue ON public.sender_profile_replies(profile_id,handled_at,received_at DESC);
ALTER TABLE public.sender_reply_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_profile_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sender_reply_channels,public.sender_profile_replies FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sender_reply_channels TO service_role;
GRANT SELECT,UPDATE ON public.sender_profile_replies TO service_role;

CREATE FUNCTION public.invalidate_sender_reply_channel_on_address_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.from_email IS DISTINCT FROM OLD.from_email OR NEW.reply_to IS DISTINCT FROM OLD.reply_to THEN
    DELETE FROM public.sender_reply_channels WHERE profile_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_sender_reply_channel_on_address_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sender_profile_reply_address_changed
AFTER UPDATE OF from_email,reply_to ON public.sender_profiles
FOR EACH ROW EXECUTE FUNCTION public.invalidate_sender_reply_channel_on_address_change();

CREATE FUNCTION public.record_sender_profile_reply(_token_hash text,_message uuid,_domain text,_source_hash text,_received_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE profile uuid;
BEGIN
  SELECT ch.profile_id INTO profile FROM public.sender_reply_channels ch WHERE ch.token_hash=_token_hash;
  IF NOT FOUND THEN RETURN 'unauthorized'; END IF;
  IF _received_at IS NULL OR _received_at>now()+interval '5 minutes' THEN RETURN 'ignored'; END IF;
  INSERT INTO public.sender_profile_replies(profile_id,message_id,source_hash,received_at)
  SELECT profile,m.id,_source_hash,_received_at FROM public.campaign_messages m
  JOIN public.campaigns c ON c.id=m.campaign_id
  WHERE m.id=_message AND c.sender_profile_id=profile AND c.list_id IS NOT NULL AND m.sent_at IS NOT NULL
    AND _received_at>=m.sent_at AND lower(split_part(c.from_email,'@',2))=_domain
  ON CONFLICT (profile_id,source_hash) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'stored' ELSE 'ignored' END;
END;
$$;
REVOKE ALL ON FUNCTION public.record_sender_profile_reply(text,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sender_profile_reply(text,uuid,text,text,timestamptz) TO service_role;
COMMIT;
