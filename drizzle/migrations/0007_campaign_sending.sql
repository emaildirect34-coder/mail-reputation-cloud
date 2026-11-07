CREATE TABLE public.contact_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE, email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'), email_md5 text GENERATED ALWAYS AS (md5(lower(btrim(email)))) STORED, first_name text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','complained')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(list_id,email));
CREATE INDEX contacts_md5 ON public.contacts(email_md5);
CREATE TABLE public.suppressions (email_md5 text PRIMARY KEY CHECK (email_md5 ~ '^[0-9a-f]{32}$'), reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','unsubscribe','bounce','complaint','sponsor')), source text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, from_name text NOT NULL, from_email text NOT NULL, reply_to text, subject text NOT NULL, html text NOT NULL, list_id uuid REFERENCES public.contact_lists(id) ON DELETE SET NULL, server_ids uuid[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','paused','done','cancelled')), total integer NOT NULL DEFAULT 0, suppressed integer NOT NULL DEFAULT 0, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.campaign_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE, contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL, email text NOT NULL, first_name text, server_id uuid NOT NULL REFERENCES public.managed_servers(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','sent','failed')), unsub_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(18),'hex'), error text, claimed_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX campaign_messages_queue ON public.campaign_messages(server_id,status);
CREATE INDEX campaign_messages_campaign ON public.campaign_messages(campaign_id,status);

GRANT SELECT ON public.contact_lists, public.contacts, public.suppressions, public.campaigns, public.campaign_messages TO authenticated;
GRANT ALL ON public.contact_lists, public.contacts, public.suppressions, public.campaigns, public.campaign_messages TO service_role;
ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY lists_read ON public.contact_lists FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin'));
CREATE POLICY contacts_read ON public.contacts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin'));
CREATE POLICY supp_read ON public.suppressions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin'));
CREATE POLICY campaigns_read ON public.campaigns FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin'));
CREATE POLICY messages_read ON public.campaign_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'superadmin'));

CREATE OR REPLACE FUNCTION public.claim_campaign_messages(_server uuid, _limit integer)
RETURNS SETOF public.campaign_messages LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.campaign_messages m SET status='claimed', claimed_at=now()
  WHERE m.id IN (
    SELECT cm.id FROM public.campaign_messages cm JOIN public.campaigns c ON c.id=cm.campaign_id
    WHERE cm.server_id=_server AND c.status='queued' AND (cm.status='queued' OR (cm.status='claimed' AND cm.claimed_at < now() - interval '15 minutes'))
    ORDER BY cm.created_at LIMIT LEAST(_limit,500) FOR UPDATE OF cm SKIP LOCKED)
  RETURNING m.*;
$$;
REVOKE ALL ON FUNCTION public.claim_campaign_messages(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_messages(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_stats()
RETURNS TABLE(campaign_id uuid, queued bigint, sent bigint, failed bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT campaign_id, count(*) FILTER (WHERE status IN ('queued','claimed')), count(*) FILTER (WHERE status='sent'), count(*) FILTER (WHERE status='failed') FROM public.campaign_messages GROUP BY campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.campaign_stats() TO authenticated;