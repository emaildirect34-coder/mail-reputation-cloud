BEGIN;

CREATE TABLE public.sender_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
 from_name text NOT NULL CHECK (char_length(from_name) BETWEEN 1 AND 120),
 from_email text NOT NULL,
 reply_to text,
 enabled boolean NOT NULL DEFAULT true,
 from_verified_at timestamptz,
 reply_verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sender_profile_challenges (
 profile_id uuid NOT NULL REFERENCES public.sender_profiles(id) ON DELETE CASCADE,
 email text NOT NULL,
 code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 delivery_code text NOT NULL CHECK (delivery_code ~ '^[0-9]{8}$'),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts_left integer NOT NULL CHECK (attempts_left BETWEEN 0 AND 5),
 campaign_id uuid NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
 PRIMARY KEY (profile_id,email)
);
ALTER TABLE public.campaigns ADD COLUMN sender_profile_id uuid REFERENCES public.sender_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.sender_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_profile_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sender_profiles,public.sender_profile_challenges FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.sender_profiles TO service_role;

CREATE FUNCTION public.sender_profile_binding_available(_email text,_server uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.sending_domains d
  JOIN public.server_domain_bindings b ON b.domain_id=d.id AND b.server_id=_server AND b.status='installed'
  JOIN public.managed_servers s ON s.id=b.server_id AND s.status<>'absent'
  JOIN public.server_agents a ON a.server_id=b.server_id
  WHERE d.domain=lower(split_part(_email,'@',2)) AND a.status='online'
   AND a.metrics->>'vmtaRouting'='true' AND a.vmta_config_hash IS NOT NULL AND a.applied_hash=a.vmta_config_hash
 )
$$;

CREATE FUNCTION public.sender_profile_usable(_profile uuid,_server uuid,_from_name text,_from_email text,_reply_to text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.sender_profiles p
  WHERE p.id=_profile AND p.enabled AND p.from_verified_at IS NOT NULL
   AND (p.reply_to IS NULL OR p.reply_verified_at IS NOT NULL)
   AND p.from_name=btrim(_from_name) AND p.from_email=lower(btrim(_from_email))
   AND p.reply_to IS NOT DISTINCT FROM nullif(lower(btrim(_reply_to)),'')
   AND public.sender_profile_binding_available(p.from_email,_server)
 )
$$;

CREATE FUNCTION public.check_campaign_sender_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.sender_profile_id IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.sender_profiles p WHERE p.id=NEW.sender_profile_id FOR SHARE;
 IF NOT FOUND OR coalesce(cardinality(NEW.server_ids),0)=0 OR EXISTS (
  SELECT 1 FROM unnest(NEW.server_ids) sid
  WHERE NOT public.sender_profile_usable(NEW.sender_profile_id,sid,NEW.from_name,NEW.from_email,NEW.reply_to)
 ) THEN RAISE EXCEPTION 'Le profil expéditeur a changé ou son domaine est indisponible sur ce serveur.'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER check_campaign_sender_profile BEFORE INSERT ON public.campaigns
 FOR EACH ROW WHEN (NEW.sender_profile_id IS NOT NULL) EXECUTE FUNCTION public.check_campaign_sender_profile();

CREATE FUNCTION public.invalidate_sender_profile_challenges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.from_email IS DISTINCT FROM OLD.from_email THEN NEW.from_verified_at := NULL; END IF;
 IF NEW.reply_to IS DISTINCT FROM OLD.reply_to THEN NEW.reply_verified_at := NULL; END IF;
 IF NEW.reply_to=NEW.from_email THEN NEW.reply_verified_at := NEW.from_verified_at; END IF;
 UPDATE public.campaigns SET status='cancelled' WHERE id IN (
  SELECT c.campaign_id FROM public.sender_profile_challenges c WHERE c.profile_id=OLD.id
 ) AND status IN ('queued','paused');
 DELETE FROM public.sender_profile_challenges WHERE profile_id=OLD.id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_sender_profile_challenges BEFORE UPDATE OF from_email,reply_to,enabled ON public.sender_profiles
 FOR EACH ROW WHEN (ROW(OLD.from_email,OLD.reply_to,OLD.enabled) IS DISTINCT FROM ROW(NEW.from_email,NEW.reply_to,NEW.enabled))
 EXECUTE FUNCTION public.invalidate_sender_profile_challenges();

CREATE FUNCTION public.issue_sender_profile_code(_profile uuid,_server uuid,_email text,_code text,_hash text,_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 profile public.sender_profiles;
 previous public.sender_profile_challenges;
 issued timestamptz;
 deadline timestamptz;
 verification_campaign uuid;
BEGIN
 IF NOT public.has_role(_actor,'superadmin') OR _code IS NULL OR _code !~ '^[0-9]{8}$'
  OR _hash IS NULL OR _hash !~ '^[0-9a-f]{64}$' THEN RETURN 'unavailable'; END IF;
 SELECT * INTO profile FROM public.sender_profiles WHERE id=_profile AND enabled FOR UPDATE;
 IF NOT FOUND OR (_email IS DISTINCT FROM profile.from_email AND _email IS DISTINCT FROM profile.reply_to) OR _email IS NULL THEN
  RETURN 'unavailable';
 END IF;
 IF NOT public.sender_profile_binding_available(profile.from_email,_server) OR NOT EXISTS (
  SELECT 1 FROM public.server_agents a WHERE a.server_id=_server AND a.metrics->>'preferencePermit'='true'
 ) THEN RETURN 'binding'; END IF;
 IF EXISTS (SELECT 1 FROM public.suppressions s WHERE s.email_md5=md5(_email)) THEN RETURN 'suppressed'; END IF;
 SELECT * INTO previous FROM public.sender_profile_challenges WHERE profile_id=_profile AND email=_email;
 issued := clock_timestamp();
 IF previous.issued_at>issued-interval '1 minute' THEN RETURN 'throttled'; END IF;
 deadline := issued+interval '15 minutes';
 INSERT INTO public.campaigns(name,from_name,from_email,subject,html,status,server_ids,total,created_by,send_expires_at)
 VALUES ('Vérification du profil expéditeur','Email Direct',profile.from_email,'Votre code de vérification Email Direct',
  '<p>Vérification de votre profil expéditeur Email Direct.</p>',
  'queued',ARRAY[_server],1,_actor,deadline) RETURNING id INTO verification_campaign;
 IF NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id=verification_campaign AND public.campaign_can_claim(c,_server)) THEN
  DELETE FROM public.campaigns WHERE id=verification_campaign;
  RETURN 'binding';
 END IF;
 IF previous.campaign_id IS NOT NULL THEN
  UPDATE public.campaigns SET status='cancelled' WHERE id=previous.campaign_id AND status IN ('queued','paused');
 END IF;
 INSERT INTO public.campaign_messages(campaign_id,server_id,email) VALUES (verification_campaign,_server,_email);
 INSERT INTO public.sender_profile_challenges(profile_id,email,code_hash,delivery_code,issued_at,expires_at,attempts_left,campaign_id)
 VALUES (_profile,_email,_hash,_code,issued,deadline,5,verification_campaign)
 ON CONFLICT (profile_id,email) DO UPDATE SET code_hash=excluded.code_hash,delivery_code=excluded.delivery_code,issued_at=excluded.issued_at,
  expires_at=excluded.expires_at,attempts_left=5,campaign_id=excluded.campaign_id;
 RETURN 'queued';
END;
$$;

CREATE FUNCTION public.confirm_sender_profile_code(_profile uuid,_email text,_hash text,_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 profile public.sender_profiles;
 challenge public.sender_profile_challenges;
 confirmed timestamptz;
BEGIN
 IF NOT public.has_role(_actor,'superadmin') THEN RETURN 'unavailable'; END IF;
 SELECT * INTO profile FROM public.sender_profiles WHERE id=_profile AND enabled FOR UPDATE;
 IF NOT FOUND OR (_email IS DISTINCT FROM profile.from_email AND _email IS DISTINCT FROM profile.reply_to) OR _email IS NULL THEN
  RETURN 'unavailable';
 END IF;
 SELECT * INTO challenge FROM public.sender_profile_challenges WHERE profile_id=_profile AND email=_email FOR UPDATE;
 confirmed := clock_timestamp();
 IF NOT FOUND OR challenge.expires_at<=confirmed OR challenge.attempts_left=0 THEN RETURN 'expired'; END IF;
 IF challenge.code_hash IS DISTINCT FROM _hash THEN
  UPDATE public.sender_profile_challenges SET attempts_left=attempts_left-1 WHERE profile_id=_profile AND email=_email;
  RETURN 'invalid';
 END IF;
 UPDATE public.sender_profiles SET
  from_verified_at=CASE WHEN from_email=_email THEN confirmed ELSE from_verified_at END,
  reply_verified_at=CASE WHEN reply_to=_email THEN confirmed ELSE reply_verified_at END WHERE id=_profile;
 DELETE FROM public.sender_profile_challenges WHERE profile_id=_profile AND email=_email;
 UPDATE public.campaigns SET status='cancelled' WHERE id=challenge.campaign_id AND status IN ('queued','paused');
 RETURN 'verified';
END;
$$;

CREATE FUNCTION public.read_agent_sender_profile_codes(_server uuid,_ids uuid[])
RETURNS TABLE(message_id uuid,code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT m.id,p.delivery_code FROM public.campaign_messages m
 JOIN public.sender_profile_challenges p ON p.campaign_id=m.campaign_id AND p.email=m.email
 JOIN public.campaigns c ON c.id=m.campaign_id AND c.status='queued'
 WHERE m.id=ANY(_ids) AND m.server_id=_server AND m.status='claimed' AND p.expires_at>now()
$$;

REVOKE ALL ON FUNCTION public.sender_profile_binding_available(text,uuid),public.check_campaign_sender_profile(),
 public.invalidate_sender_profile_challenges() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sender_profile_usable(uuid,uuid,text,text,text),
 public.issue_sender_profile_code(uuid,uuid,text,text,text,uuid),public.confirm_sender_profile_code(uuid,text,text,uuid),
 public.read_agent_sender_profile_codes(uuid,uuid[])
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sender_profile_usable(uuid,uuid,text,text,text),
 public.issue_sender_profile_code(uuid,uuid,text,text,text,uuid),public.confirm_sender_profile_code(uuid,text,text,uuid),
 public.read_agent_sender_profile_codes(uuid,uuid[])
 TO service_role;
COMMIT;
