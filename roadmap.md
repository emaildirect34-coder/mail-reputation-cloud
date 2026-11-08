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
- [x] Agent sur chaque serveur (installation en une commande), config Lua générée (pools, IPs, quotas warmup, double DKIM), clés DKIM installées automatiquement, état et métriques remontés.
- [ ] Vérifier sur un vrai serveur — aucun serveur enregistré pour l’instant.
## Phase 4 — Campagnes réelles
- [x] Listes/contacts (import CSV), suppression MD5, envoi réel via les agents KumoMTA, désinscription en 1 clic (RFC 8058).
- [ ] Vérifier un envoi réel de bout en bout — aucun serveur avec agent pour l’instant.
## Phase 5 — Événements & logs
- [x] Enregistrer les événements KumoMTA authentifiés et dédupliqués, distinguer injection et livraison, supprimer les adresses en rebond dur/plainte.
- [x] Afficher les vrais journaux filtrables, export CSV et alertes; suspendre les nouvelles injections automatiquement selon les seuils de protection (messages déjà dans KumoMTA non rappelés).
- [x] Vérifier l’API avec 18 événements temporaires, déduplication, rejet d’un message étranger, suspension, 17 suppressions, filtres/CSV connecté et téléphone; données de test nettoyées.
- [ ] Vérifier collecte locale et livraisons sur un vrai serveur; brancher les flux ARF des FAI — aucun serveur actif ni abonnement FBL disponible.
## Phase 6 — IA Gateway & Skills
- [x] Diagnostics IA réels par skill : objet, contenu, DNS et journaux, avec accès vérifiés et données minimisées.
- [x] Propositions avant/après appliquées au brouillon avec confirmation et annulation; DNS reste une action Cloudflare séparée, sans commandes arbitraires.
- [x] Remplacer la démonstration Hermes par une console réelle; analyse réelle et application relues, boutons campagne/journaux vérifiés et fenêtre mobile sans débordement; quatre tests de permissions réussis.
- [ ] Vérifier diagnostic DNS sur un domaine configuré et correction DNS chez Cloudflare — aucun domaine/compte configuré disponible pour cet essai.
- [ ] Connexion OAuth des abonnements ChatGPT/Claude — nécessite une intégration officielle compatible; aucune connexion simulée.
## Phase 7 — Offres sponsors & revenus
- [x] Comptes sponsors multi-comptes, offres persistantes, création/import JSON, connecteur offres Everflow affilié US et liaison au Campaign Builder.
- [x] Journal financier par compte et campagne : revenus en attente/validés/payés/rejetés, dépenses, devises séparées, filtres et export.
- [x] Tableau financier avec résultat, encaissements déclarés, échéances, soldes à recevoir et eCPM basé sur livraisons mesurées; sept tests réussis, parcours connecté (offre, compte, campagne, revenu, dépense, paiement, doublon, devises et CSV), téléphone 390/538 px; données d’essai nettoyées.
- [ ] Vérifier synchronisation Everflow externe — nécessite un compte sponsor et sa clé affilié; les rémunérations multiples/non reconnues sont ignorées explicitement.
- [ ] Import automatique des conversions et rapprochement des paiements sponsors — nécessite le contrat API du réseau et un compte réel; actuellement saisie/import financier, pas de connexion bancaire.

- [x] Mail-Tester : connecteur Lab prêt (contrat docs/CODEX.md)
- [ ] Mail-Tester : renseigner MAILTESTER_URL et MAILTESTER_KEY quand le serveur Codex est en ligne
- [x] Files KumoMTA et Traffic Shaping sur données réelles

# Nouveaux modules (un par un)
- [x] Validation d'emails réelle (syntaxe, fautes, MX, jetables, rôles, suppression) + nettoyage de listes
- [ ] Pre-Flight Gate branché aux campagnes
- [ ] Testeur de placement Inbox/Spam/Promo
- [ ] Alertes Slack/Webhook/Email
- [ ] Éditeur visuel de templates
- [ ] Optimiseur IA d'objets
- [ ] Tracking clics/ouvertures sur vos sous-domaines
- [ ] Régulation dynamique par FAI + FBL
- [ ] Rapprochement automatique des conversions sponsors
