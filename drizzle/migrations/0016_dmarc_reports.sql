CREATE TABLE public.dmarc_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name text NOT NULL,
  report_id text NOT NULL,
  domain text NOT NULL,
  policy text,
  date_begin timestamptz,
  date_end timestamptz,
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  records jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_name, report_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmarc_reports TO authenticated;
GRANT ALL ON public.dmarc_reports TO service_role;
ALTER TABLE public.dmarc_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmarc read" ON public.dmarc_reports FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'superadmin') OR EXISTS (
    SELECT 1 FROM public.worker_tasks t WHERE t.user_id = auth.uid() AND t.status = 'active' AND '/dashboard/dmarc' = ANY(t.allowed_paths)));
CREATE POLICY "dmarc write" ON public.dmarc_reports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin')) WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE INDEX dmarc_reports_domain_idx ON public.dmarc_reports (domain, date_end DESC);