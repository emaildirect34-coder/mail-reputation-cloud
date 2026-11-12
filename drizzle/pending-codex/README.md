Codex database changes 0027-0086 are tracked here. Check the Lovable migration history and apply the remaining files in order with the migration tool (strip BEGIN/COMMIT when the tool manages transactions). Changes 0017-0026 were consolidated in the base migrations.

The product-level status and remaining deployment dependencies for the 34 requested feature areas are tracked in [FEATURES-AUDIT-34.md](../../docs/FEATURES-AUDIT-34.md).

Migration `0082_audit_and_weekly_report.sql` adds a restricted audit event store and a measured seven-day operations summary. The report counts SMTP acceptance separately from injection, and does not send mail or estimate inbox placement.

`0083_campaign_exclusion_ledger.sql` records hashed contact identifiers and exclusion reasons for new campaign launches. Superadmins can export associated addresses and reasons from the campaign list; each export is audited.

`0084_vendor_invoices_and_webhook_retries.sql` adds a separate, superadmin-only supplier invoice ledger with idempotent CSV import; it does not mix vendor bills with sponsor accounting. It also adds a persistent webhook retry queue, a bounded retry claim RPC, and certificate expiry snapshots for Cloudflare-managed zones. The `webhook-retries` scheduled job must be called with the existing cron bearer authentication. TLS expiry is queried through the Cloudflare certificate-pack API, not domain registration data.

`0085_monitoring_reconciliation_and_revisions.sql` adds invoice-payment reconciliation with duplicate-reference protection, private webhook attempt latency metrics, and public-value-only DNS snapshots with guarded restore. The existing incident-notifications job now scans Cloudflare certificates and flags campaigns whose queued messages have no progress; expiry alerts go to subscribed `tls_expiration` webhooks, at most weekly per certificate expiry.

`0086_testing_editorial_and_link_preflight.sql` adds a minimum per-variant sample and significance-gated A/B decisions (baseline A is used when evidence is insufficient), a private campaign editorial workflow, and a restricted historical seed-placement store. The dashboard link preflight checks only HTTPS hosts explicitly listed in `CAMPAIGN_AUDIT_HOSTS`; unapproved hosts and redirects are reported for manual review.

`0076_campaign_outcomes.sql` adds campaign comparison metrics and creates follow-up checklist items when a campaign completes. `0077_email_template_library.sql` adds private saved email templates with immutable version snapshots and reusable HTML content blocks. Both migrations use service-role-only database access; their dashboard actions are superadmin-checked.

`0078_complete_ab_holdout.sql` keeps the unassigned audience in the queue during an A/B test, chooses a winner after the scheduled decision time once every variant has an SMTP attempt, and releases the remaining audience using the winning variant. Agents execute this decision automatically while claiming the next batch; the dashboard can also request an early decision.

`0079_server_config_history.sql` records only server configuration hashes and timestamps (no Lua or DKIM key material). `0080_operational_job_health.sql` records start, completion, failure, and duration for the authenticated daily-report and incident-notification jobs. `0081_contact_privacy_requests.sql` adds a superadmin-only erasure operation that removes contact/preferences, anonymizes historic message addresses, rotates unsubscribe tokens, invalidates review links, and keeps only a suppression hash to prevent reimport. Sponsor accounting entries remain intact.

`0082_audit_and_weekly_report.sql` adds a service-role-only audit store and a measured seven-day operations summary. The Operations page probes Mail-Tester server-side, displays recent agent and scheduler health, and prints the weekly report to PDF. It does not send the report by email.
