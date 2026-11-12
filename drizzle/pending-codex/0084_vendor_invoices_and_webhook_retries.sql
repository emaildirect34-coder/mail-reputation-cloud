BEGIN;
CREATE TABLE public.infrastructure_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vendor text NOT NULL CHECK (length(vendor) BETWEEN 1 AND 120),
 invoice_number text NOT NULL CHECK (length(invoice_number) BETWEEN 1 AND 160),
 amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
 currency text NOT NULL CHECK (currency IN ('EUR','USD','GBP')),
 status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','overdue','void')),
 issued_on date NOT NULL,
 due_on date,
 description text NOT NULL DEFAULT '',
 imported_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (vendor, invoice_number)
);
CREATE INDEX infrastructure_invoices_due ON public.infrastructure_invoices(status,due_on);
ALTER TABLE public.infrastructure_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.infrastructure_invoices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.infrastructure_invoices TO service_role;

CREATE TABLE public.webhook_retry_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
 event text NOT NULL,
 payload jsonb NOT NULL,
 attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 12),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','dead')),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz,
 last_status integer,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sent_at timestamptz
);
CREATE INDEX webhook_retry_due ON public.webhook_retry_deliveries(next_attempt_at) WHERE status IN ('queued','sending');
ALTER TABLE public.webhook_retry_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_retry_deliveries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.webhook_retry_deliveries TO service_role;

CREATE FUNCTION public.claim_webhook_retries(_limit integer DEFAULT 50)
RETURNS SETOF public.webhook_retry_deliveries LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH candidates AS (
  SELECT id FROM public.webhook_retry_deliveries
  WHERE (status='queued' AND next_attempt_at<=clock_timestamp()) OR (status='sending' AND lease_until<clock_timestamp())
  ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(_limit,100))
 )
 UPDATE public.webhook_retry_deliveries q SET status='sending',lease_until=clock_timestamp()+interval '2 minutes'
 FROM candidates c WHERE q.id=c.id RETURNING q.*;
$$;
REVOKE ALL ON FUNCTION public.claim_webhook_retries(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_retries(integer) TO service_role;

CREATE TABLE public.tls_certificate_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 domain_id uuid NOT NULL REFERENCES public.sending_domains(id) ON DELETE CASCADE,
 certificate_host text NOT NULL,
 certificate_status text NOT NULL,
 expires_on timestamptz,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(domain_id,certificate_host)
);
CREATE INDEX tls_certificate_checks_expiry ON public.tls_certificate_checks(expires_on);
ALTER TABLE public.tls_certificate_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tls_certificate_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tls_certificate_checks TO service_role;

ALTER TABLE public.operational_job_runs DROP CONSTRAINT operational_job_runs_job_check;
ALTER TABLE public.operational_job_runs ADD CONSTRAINT operational_job_runs_job_check CHECK (job IN ('daily-report','incident-notifications','webhook-retries'));
CREATE OR REPLACE FUNCTION public.start_operational_job(_job text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE run_id uuid;
BEGIN
 IF _job NOT IN ('daily-report','incident-notifications','webhook-retries') THEN RAISE EXCEPTION 'unknown operational job'; END IF;
 INSERT INTO public.operational_job_runs(job,status) VALUES(_job,'running') RETURNING id INTO run_id;
 RETURN run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_operational_job(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_operational_job(text) TO service_role;
COMMIT;
