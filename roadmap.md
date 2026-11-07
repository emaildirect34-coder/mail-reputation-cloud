# Dashboard design
- [x] Recreate the central cockpit from the supplied reference.
- [x] Align the header and navigation with the cockpit reference.
- [x] Verify the signed-in dashboard, navigation and small-screen layout.

# Campaign clarity
- [x] Campaign builder on one page, organized and clear.
- [x] Preserve email, targeting, delivery and advanced settings.
- [x] Verify campaign interactions and sponsor navigation on desktop and mobile.

# Navigation at the top
- [x] Move the site title and the section sub-menus from the left side panel to the top bar.
- [x] Verify the top bar at the user's screen width and on a narrow screen.

# Full-width stacking on every page
- [x] Apply one logic to all dashboard pages: KPIs, details full width, table full width, quick actions at the bottom, no side column.
- [x] Convert all routes: campaigns module, infrastructure, domain & auth, deliverability, data & ops, settings, agent, home cockpit.
- [x] Verify every route renders with no horizontal overflow and no covered content.

# Open
- [ ] Wire the demo buttons and demo data to real delivery services (sending, DNS sync, sponsor APIs).

# Real providers (multi-account)
- [x] Multi-account for every provider: Cloudflare (token or global key), Linode, Vultr, Hetzner, DigitalOcean, Google Postmaster.
- [x] Live server catalogue with prices + direct purchase/deploy of KumoMTA servers.
- [x] Cloudflare zones + one-click mail DNS deployment.
- [ ] Google Postmaster: real data needs a Google OAuth app (blocked on user's Google Cloud credentials).
- [x] Gmail Postmaster live page (API v2, service account)

# Plan par phases (fonctionnel réel)
## Phase 1 — Domaines & authentification
- [x] Domaines réels en base, double DKIM (2 clés RSA 2048 par domaine), SPF, DMARC strict, MTA-STS, TLS-RPT.
- [x] Publication en un clic sur Cloudflare (multi-comptes) + contrôle DNS public en direct.
- [ ] rDNS/PTR automatique via Linode sur les IP des serveurs.
## Phase 2 — Serveurs, IP & pools
- [x] Implémenter la synchronisation multi-comptes Linode/Vultr/Hetzner/DigitalOcean, les IPs et plages IPv6, les pools VMTA persistants et les brouillons warmup par FAI.
- [x] Associer domaines et serveurs pour installation DKIM automatique, avec état réel en attente d’agent (phase 3).
- [x] Vérifier connecté les quatre pages, création et relecture d’un pool, tests d’accès et quotas, téléphone sans débordement.
- [ ] Vérifier synchronisation réelle, affectation IP et plan warmup de bout en bout — aucun compte fournisseur ni serveur enregistré.
## Phase 3 — Moteur d'envoi KumoMTA
- [ ] Agent/API sur chaque serveur (config Lua générée: DKIM, pools, shaping); push de config.
## Phase 4 — Campagnes réelles
- [ ] Listes/contacts, suppression MD5, envoi des campagnes via KumoMTA, désabonnement 1-clic.
## Phase 5 — Événements & logs
- [ ] Webhooks KumoMTA (delivered/bounce/FBL) → logs, stats, coupe-circuits.
## Phase 6 — IA Gateway & Skills
- [ ] Boutons IA par page (diagnostic objet/contenu/DNS) avec correction appliquée.
## Phase 7 — Offres sponsors & revenus
- [ ] Import d'offres via API, suivi eCPM.
