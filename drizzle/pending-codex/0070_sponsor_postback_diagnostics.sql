BEGIN;

CREATE TABLE public.sponsor_postback_rejections (
  account_id uuid NOT NULL REFERENCES public.sponsor_accounts(id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN ('body','click','amount','payout','unknown_click','unknown_campaign','other_account','no_offer','transaction_conflict','service')),
  reference_hash text NOT NULL CHECK (reference_hash='' OR reference_hash ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 1,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id,bucket,reason,reference_hash)
);
CREATE INDEX sponsor_postback_rejections_recent ON public.sponsor_postback_rejections(last_seen DESC);
ALTER TABLE public.sponsor_postback_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_postback_rejections FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,DELETE ON public.sponsor_postback_rejections TO service_role;

CREATE FUNCTION public.log_sponsor_postback_rejection(_account uuid,_reason text,_reference_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  INSERT INTO public.sponsor_postback_rejections(account_id,bucket,reason,reference_hash)
  SELECT _account,date_trunc('hour',now(),'UTC'),_reason,coalesce(_reference_hash,'')
  FROM public.sponsor_accounts WHERE id=_account
  ON CONFLICT (account_id,bucket,reason,reference_hash) DO UPDATE
  SET attempts=least(public.sponsor_postback_rejections.attempts::bigint+1,2147483647)::integer,last_seen=now()
$$;

CREATE TABLE public.sponsor_postback_diagnostics (
  account_id uuid PRIMARY KEY REFERENCES public.sponsor_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expected_event text NOT NULL CHECK (expected_event ~ '^[a-zA-Z0-9_.:-]{1,100}$'),
  expires_at timestamptz NOT NULL,
  checked_at timestamptz,
  succeeded boolean,
  detail text,
  CHECK (detail IS NULL OR length(detail)<=150)
);
ALTER TABLE public.sponsor_postback_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_postback_diagnostics FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sponsor_postback_diagnostics TO service_role;
REVOKE ALL ON FUNCTION public.log_sponsor_postback_rejection(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.log_sponsor_postback_rejection(uuid,text,text) TO service_role;
COMMIT;
