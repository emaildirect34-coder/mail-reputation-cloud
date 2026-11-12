BEGIN;
ALTER TABLE public.infrastructure_invoices
 ADD COLUMN paid_on date,
 ADD COLUMN payment_reference text CHECK (payment_reference IS NULL OR length(payment_reference)<=200),
 ADD COLUMN settled_amount_cents bigint CHECK (settled_amount_cents IS NULL OR settled_amount_cents>=0);
CREATE TABLE public.infrastructure_invoice_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES public.infrastructure_invoices(id) ON DELETE CASCADE,
 payment_reference text NOT NULL CHECK (length(payment_reference) BETWEEN 1 AND 200),
 amount_cents bigint NOT NULL CHECK (amount_cents>0),
 currency text NOT NULL CHECK (currency IN ('EUR','USD','GBP')),
 paid_on date NOT NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(invoice_id,payment_reference)
);
ALTER TABLE public.infrastructure_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.infrastructure_invoice_payments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.infrastructure_invoice_payments TO service_role;
CREATE FUNCTION public.record_vendor_invoice_payment(_invoice uuid,_reference text,_amount bigint,_currency text,_paid_on date,_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv public.infrastructure_invoices%ROWTYPE; inserted_id uuid; settled bigint; current_settled bigint;
BEGIN
 SELECT * INTO inv FROM public.infrastructure_invoices WHERE id=_invoice FOR UPDATE;
 IF NOT FOUND OR inv.status='void' OR _amount<=0 OR _currency<>inv.currency OR length(btrim(_reference)) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO current_settled FROM public.infrastructure_invoice_payments WHERE invoice_id=_invoice;
 IF current_settled+_amount>inv.amount_cents THEN RETURN false; END IF;
 INSERT INTO public.infrastructure_invoice_payments(invoice_id,payment_reference,amount_cents,currency,paid_on,created_by)
 VALUES(_invoice,btrim(_reference),_amount,_currency,_paid_on,_actor) ON CONFLICT(invoice_id,payment_reference) DO NOTHING RETURNING id INTO inserted_id;
 IF inserted_id IS NULL THEN RETURN false; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO settled FROM public.infrastructure_invoice_payments WHERE invoice_id=_invoice;
 UPDATE public.infrastructure_invoices SET settled_amount_cents=settled,
  status=CASE WHEN settled>=amount_cents THEN 'paid' WHEN due_on IS NOT NULL AND due_on<_paid_on THEN 'overdue' ELSE 'unpaid' END,
  paid_on=CASE WHEN settled>=amount_cents THEN (SELECT max(paid_on) FROM public.infrastructure_invoice_payments WHERE invoice_id=_invoice) ELSE NULL END,
  payment_reference=btrim(_reference)
 WHERE id=_invoice;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_vendor_invoice_payment(uuid,text,bigint,text,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_vendor_invoice_payment(uuid,text,bigint,text,date,uuid) TO service_role;

ALTER TABLE public.webhook_endpoints ADD COLUMN last_duration_ms integer CHECK (last_duration_ms IS NULL OR last_duration_ms>=0);
ALTER TABLE public.tls_certificate_checks ADD COLUMN last_alerted_at timestamptz;
CREATE TABLE public.webhook_delivery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL,
 event text NOT NULL,
 ok boolean NOT NULL,
 status_code integer,
 duration_ms integer NOT NULL CHECK (duration_ms>=0),
 error text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX webhook_delivery_attempts_recent ON public.webhook_delivery_attempts(created_at DESC);
ALTER TABLE public.webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_delivery_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.webhook_delivery_attempts TO service_role;

CREATE TABLE public.dns_config_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 domain_id uuid NOT NULL REFERENCES public.sending_domains(id) ON DELETE CASCADE,
 account_id uuid,
 zone_id text NOT NULL,
 records jsonb NOT NULL CHECK (jsonb_typeof(records)='array'),
 managed_records jsonb NOT NULL CHECK (jsonb_typeof(managed_records)='array'),
 reason text NOT NULL CHECK (reason IN ('before_publish','before_restore')),
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX dns_config_revisions_recent ON public.dns_config_revisions(domain_id,created_at DESC);
ALTER TABLE public.dns_config_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dns_config_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dns_config_revisions TO service_role;
CREATE FUNCTION public.trim_dns_config_revisions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM public.dns_config_revisions WHERE domain_id=NEW.domain_id AND id NOT IN (
  SELECT id FROM public.dns_config_revisions WHERE domain_id=NEW.domain_id ORDER BY created_at DESC,id DESC LIMIT 100
 );
 RETURN NEW;
END;
$$;
CREATE TRIGGER dns_config_revisions_keep_recent AFTER INSERT ON public.dns_config_revisions
 FOR EACH ROW EXECUTE FUNCTION public.trim_dns_config_revisions();
REVOKE ALL ON FUNCTION public.trim_dns_config_revisions() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.operations_incidents DROP CONSTRAINT operations_incidents_kind_check;
ALTER TABLE public.operations_incidents ADD CONSTRAINT operations_incidents_kind_check
 CHECK (kind IN ('campaign_blocked','injection_uncertain','agent_offline','campaign_stalled'));
CREATE FUNCTION public.sync_stalled_campaign_incidents()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE checked_at timestamptz:=clock_timestamp(); observed integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(65085) THEN RETURN 0; END IF;
 WITH stalled AS (
  SELECT c.id,c.name,count(*) FILTER(WHERE m.status='queued') AS queued_count,
   min(m.created_at) FILTER(WHERE m.status='queued') AS oldest_queued,
   max(greatest(coalesce(m.sent_at,'-infinity'::timestamptz),coalesce(m.claimed_at,'-infinity'::timestamptz))) AS last_progress
  FROM public.campaigns c JOIN public.campaign_messages m ON m.campaign_id=c.id
  WHERE c.status='queued' AND c.auto_pause_reason IS NULL AND (c.scheduled_at IS NULL OR c.scheduled_at<=checked_at)
   AND (c.send_expires_at IS NULL OR c.send_expires_at>checked_at) AND c.placement_probe_of IS NULL AND NOT c.purchase_thank_you
   AND NOT (c.approval_required AND c.approved_revision IS DISTINCT FROM c.review_revision)
   AND m.status IN ('queued','claimed','sent')
  GROUP BY c.id,c.name
  HAVING count(*) FILTER(WHERE m.status='queued')>0
   AND min(m.created_at) FILTER(WHERE m.status='queued')<checked_at-interval '30 minutes'
   AND coalesce(max(greatest(coalesce(m.sent_at,'-infinity'::timestamptz),coalesce(m.claimed_at,'-infinity'::timestamptz))),'-infinity'::timestamptz)<checked_at-interval '20 minutes'
 ), incoming AS (
  INSERT INTO public.operations_incidents AS i(signal_key,kind,title,detail,affected_campaigns,affected_messages,started_at,last_observed_at)
  SELECT 'campaign-stalled:'||s.id::text,'campaign_stalled','Envoi sans progression · '||s.name,
   'Aucun message injecté ou réclamé depuis 20 minutes; messages en attente: '||s.queued_count,
   jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name)),s.queued_count,s.oldest_queued,checked_at FROM stalled s
  ON CONFLICT(signal_key) WHERE signal_cleared_at IS NULL DO UPDATE SET
   detail=excluded.detail,affected_messages=excluded.affected_messages,last_observed_at=checked_at
  RETURNING id
 ) SELECT count(*) INTO observed FROM incoming;
 UPDATE public.operations_incidents i SET signal_cleared_at=checked_at
 WHERE i.kind='campaign_stalled' AND i.signal_cleared_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM public.campaigns c JOIN public.campaign_messages m ON m.campaign_id=c.id
  WHERE i.signal_key='campaign-stalled:'||c.id::text AND c.status='queued' AND c.auto_pause_reason IS NULL
   AND (c.scheduled_at IS NULL OR c.scheduled_at<=checked_at) AND (c.send_expires_at IS NULL OR c.send_expires_at>checked_at)
   AND c.placement_probe_of IS NULL AND NOT c.purchase_thank_you AND NOT (c.approval_required AND c.approved_revision IS DISTINCT FROM c.review_revision) AND m.status='queued'
  GROUP BY c.id HAVING min(m.created_at)<checked_at-interval '30 minutes'
   AND coalesce(max(greatest(coalesce(m.sent_at,'-infinity'::timestamptz),coalesce(m.claimed_at,'-infinity'::timestamptz))),'-infinity'::timestamptz)<checked_at-interval '20 minutes'
 );
 RETURN observed;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_stalled_campaign_incidents() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_stalled_campaign_incidents() TO service_role;
COMMIT;
