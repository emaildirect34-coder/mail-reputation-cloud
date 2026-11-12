BEGIN;

CREATE TABLE public.campaign_exclusions (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  email_md5 text NOT NULL CHECK (email_md5 ~ '^[a-f0-9]{32}$'),
  reason text NOT NULL CHECK (reason IN ('segment','suppression','format','invalid_address','role_address','domain_typo','inactive','purchased','brand_block','dns_unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,email_md5)
);
CREATE INDEX campaign_exclusions_by_reason ON public.campaign_exclusions(campaign_id,reason,email_md5);
ALTER TABLE public.campaign_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_exclusions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.campaign_exclusions TO service_role;

COMMIT;
