BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN amp_html text,
  ADD CONSTRAINT campaigns_amp_html_size
    CHECK (amp_html IS NULL OR octet_length(amp_html) BETWEEN 1 AND 200000);

COMMIT;
