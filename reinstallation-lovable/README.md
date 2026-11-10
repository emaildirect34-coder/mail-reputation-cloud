# Réinstallation d’Email Direct dans Lovable

Ce dossier sépare la [copie vérifiée du VPS](vps/SHA256SUMS) des [outils du prochain déploiement](prochain-deploiement/). Le contrat des API et les réglages de l’application sont dans [docs/CODEX.md](../docs/CODEX.md).

## État vérifié le 10 novembre 2026

| Service | Emplacement | État |
| --- | --- | --- |
| Application Email Direct | `mail-reputation-cloud.lovable.app` | Version Lovable déjà publiée. La nouvelle route d’instantané Bloom n’était pas publiée lors du contrôle. |
| KumoMTA | `srv2038628.hstgr.cloud`, `/opt/email-direct`, conteneur `email-direct-sender-1` | Actif, `kumod 2026.09.29-b90d8bc1`. Agent Docker `1.0`, synchronisation environ toutes les minutes. BBR constaté sur l’hôte et dans le conteneur. |
| Mail-Tester, Rspamd, SpamAssassin | Même VPS, `/opt/mail-tester` | Conteneurs actifs. API HTTPS `testeur.mailsuite.me`, domaine de réception `check.mailsuite.me`. Le test de placement utilise la surcouche Compose dédiée. |
| Bloom | `/opt/email-direct/staged-bloom/suppression-bloom.py` | Script préparé et vérifié. Le filtre et le téléchargement automatique ne sont pas actifs en production. |
| DANE/TLSA, agent enrichi, relais DMARC | Dossier `prochain-deploiement/` et code de l’application | Outils de déploiement disponibles. La publication DNS, le branchement du relais et la mise à jour de l’agent doivent être vérifiés séparément. |

Les 27 fichiers du VPS sont copiés octet pour octet. Les quatre fichiers exécutés dans le conteneur d’envoi et les modules Mail-Tester `tester`, `placement`, `report_v2` et `advanced` ont aussi été comparés à leurs copies. Les fichiers `.env.example` et `placement.env.example` sont des modèles ajoutés ici. La copie ne contient ni jetons, ni certificats privés, ni mots de passe IMAP, ni files SMTP, ni bases SQLite, ni listes de contacts. Le Contacts Vault 149 Go et le multi-client restent hors périmètre.

## 1. Réinstaller l’application dans Lovable

1. Ouvrir [le projet Email Direct](https://lovable.dev/projects/ece3bccf-6e15-4bfe-ac67-ca95916b3d76) et vérifier que la connexion GitHub pointe vers `emaildirect34-coder/mail-reputation-cloud`. Utiliser la révision validée du projet. La branche `main` peut être synchronisée avec Lovable, donc garder l’historique publié intact.
2. Dans Lovable Cloud, vérifier le projet de base de données et l’état des migrations. Suivre [la checklist Lovable](../docs/LOVABLE-DEPLOY.md) pour appliquer uniquement les scripts manquants après sauvegarde. Plusieurs migrations modifient des fonctions de la file d’envoi. `0036` ajoute la confirmation groupée Bloom, `0037` crée le stockage privé et `0038` indexe la recherche d’un message dans les journaux.
3. Vérifier le compte superadmin et les valeurs gérées par Lovable pour l’authentification. Configurer `MAILTESTER_URL=https://testeur.mailsuite.me` et `MAILTESTER_KEY` dans les secrets serveur de l’application. `MAILTESTER_KEY` doit correspondre à `API_TOKEN` sur le VPS. En cas de nouveau projet Lovable, créer ou restaurer le superadmin dans ce projet avant de réassocier les agents.
4. Publier depuis Lovable et vérifier l’accès au tableau de bord. Depuis **Paramètres → Boîtes témoins Gmail**, vérifier les boîtes existantes ou les réajouter. Depuis le constructeur, lancer **Test Inbox** uniquement avec les boîtes dédiées. Vérifier aussi le Lab Mail-Tester et le tableau **Serveurs**.

Pour le suivi des campagnes réelles, appliquer aussi la migration `0043_campaign_placement_monitor.sql` dans Lovable. Dans **Nouvelle campagne → Envoi réel**, laisser cochée l’option des boîtes témoins. Le bouton **Suivi** rapproche les états SMTP de production et les résultats du test. Le VPS Mail-Tester utilise son API de placement existante et aucune connexion à PostgreSQL.

Pour la reprise après coupure, appliquer la migration `0044_campaign_injection_recovery.sql` avant de publier Lovable. Régénérer ensuite les scripts de l’agent depuis l’installateur publié et reconstruire l’image Docker selon les étapes ci-dessous. Vérifier dans **Files KumoMTA → À vérifier** que les injections incertaines restent isolées et que les réceptions HTTP confirmées par les journaux sont rapprochées automatiquement.

| Option | Où renseigner la configuration |
| --- | --- |
| Mail-Tester | Lovable `MAILTESTER_URL`, `MAILTESTER_KEY`. VPS Mail-Tester `API_TOKEN`, `API_HOST`, `MAIL_DOMAIN`, `PLACEMENT_KEY`. |
| Agent d’envoi | Créer le jeton depuis **Serveurs** dans Lovable. Le jeton est injecté dans le conteneur via `agent.token`. Les clés DKIM sont obtenues de l’application via l’API agent. |
| Bloom | Même `SUPPRESSION_BLOOM_KEY` côté Lovable, côté générateur et sur les agents qui vérifient le binaire. Utiliser le jeton de chaque agent pour télécharger le fichier. |
| TLSA automatique | `DANE_AUTOMATION_TARGETS` dans Lovable. Côté VPS, domaine, MX, empreinte autorisée et origine HTTPS de l’app. |
| Options du tableau de bord | Les secrets des notifications, du relais DMARC et des autres options figurent dans [CODEX.md](../docs/CODEX.md). Laisser les options non configurées désactivées. |

Le VPS communique avec l’application par les API HTTPS authentifiées. L’accès PostgreSQL de Lovable et les clés de service restent dans Lovable.

## 2. Restaurer les composants VPS si nécessaire

Si seul Lovable est réinstallé et que le VPS est toujours opérationnel, réutiliser les conteneurs existants. Pour une reconstruction, garder un instantané privé du VPS et sauvegarder les volumes Docker concernés avant toute modification. Vérifier les noms de projet Compose avant de restaurer des volumes pour éviter de créer des volumes vides à la place des anciens.

### KumoMTA avec Docker

Copier [vps/email-direct](vps/email-direct/) vers `/opt/email-direct` sur le serveur cible. Rétablir le fichier `agent.token` en mode `0600` avec le jeton du serveur correspondant. Le fichier archivé `kumo-agent` cible le domaine Lovable actuel. Sur une autre origine, utiliser l’agent généré par le nouveau projet. Les volumes `config`, `state`, `spool` et `logs` doivent être conservés pour garder notamment la file et les positions de lecture des événements.

```bash
cd /opt/email-direct
docker build -t email-direct-kumo:base -f Dockerfile .
docker compose config --quiet
docker compose build sender
docker compose up -d sender
docker compose logs --tail=80 sender
```

Ces commandes reconstruisent l’image. Le paquet KumoMTA provient du dépôt officiel configuré dans le `Dockerfile`, ce qui peut installer une version plus récente que celle observée. Valider cette version avant toute reprise de la file. Le `compose.yaml` contient le réglage BBR. Le modèle `prochain-deploiement/90-email-direct-bbr.conf.example` reprend les valeurs `fq` et `bbr` vérifiées dans `/etc/sysctl.d/90-email-direct-bbr.conf` sur l’hôte. Vérifier la prise en charge du noyau avant de restaurer ces valeurs. Vérifier ensuite `sysctl -n net.ipv4.tcp_congestion_control` sur l’hôte et avec `docker compose exec -T sender sysctl -n net.ipv4.tcp_congestion_control`.

L’archive est celle de l’agent Docker actif. Les fonctions récentes, dont le récapitulatif, l’attribution IP et Bloom, nécessitent l’agent de la nouvelle version de l’application. L’installateur Lovable complet est prévu pour un hôte avec systemd. Pour le conteneur de production, intégrer les scripts d’agent générés dans l’image Docker en gardant son `entrypoint`, ses montages, sa file et son mécanisme de rechargement. Le script `install.sh` archivé sert à retracer l’installation initiale.

Pour préparer l’image actualisée, copier `prochain-deploiement/` dans `/opt/email-direct/prochain-deploiement`. Utiliser ces commandes depuis `/opt/email-direct` une fois la nouvelle application publiée et ses migrations appliquées.

```bash
app=https://mail-reputation-cloud.lovable.app
curl -fsS "$app/api/public/agent/install.sh" -o agent-lovable.download
python3 prochain-deploiement/preparer-agent-docker.py agent-lovable.download "$app" image-agent-update
docker build -t email-direct-kumo:agent-update image-agent-update
```

Le préparateur extrait les trois scripts attendus et refuse un ancien installateur. Il n’exécute pas le fichier téléchargé. Créer `/etc/email-direct/suppression-bloom.env` en mode `0600`. Il peut rester vide si Bloom est désactivé, ou être renseigné à partir de `suppression-bloom.env.example`. Une fois l’image testée et la file sauvegardée, basculer le conteneur vers cette image en conservant les volumes.

```bash
docker compose -f compose.yaml -f prochain-deploiement/compose.agent-update.yaml config --quiet
docker compose -f compose.yaml -f prochain-deploiement/compose.agent-update.yaml up -d --no-build sender
docker compose -f compose.yaml -f prochain-deploiement/compose.agent-update.yaml logs --tail=80 sender
```

Cette bascule recrée le conteneur d’envoi. Vérifier la synchronisation de l’agent après la reprise. L’image `email-direct-kumo:production` reste disponible pour un retour à la recette Compose d’origine. Un retour du conteneur ne restaure pas la base Lovable.

### Mail-Tester avec le proxy partagé

Copier [vps/mail-tester](vps/mail-tester/) vers `/opt/mail-tester`. Créer `.env` et `.env.placement` à partir des modèles, en mode `0600`. Le volume `/data` contient la base SQLite, dont les boîtes témoins chiffrées. Restaurer la clé `PLACEMENT_KEY` qui correspond à cette base. Avec une base neuve, générer une clé Fernet et réajouter les boîtes. Créer `/etc/mailtester` pour le montage en lecture seule. Si des boîtes supplémentaires sont configurées dans `seeds.yml`, protéger le fichier et garder leurs mots de passe sur le VPS.

```bash
cd /opt/mail-tester
docker build -t mail-tester-placement-base:local -f Dockerfile .
docker network inspect lobehub_lobe-network >/dev/null
docker compose -f compose.yaml -f compose.vps.yaml -f compose.placement.yaml config --quiet
docker compose -f compose.yaml -f compose.vps.yaml -f compose.placement.yaml up -d --build tester rspamd spamassassin
```

Le proxy Caddy partagé doit joindre le réseau `lobehub_lobe-network` et envoyer `testeur.mailsuite.me` vers `mailsuite-tester-api:8000`. Sur un serveur différent, adapter le réseau ou le proxy à son architecture. Le `Caddyfile` archivé est le modèle du mode autonome. `install-vps.sh` est une trace historique spécifique à l’ancien proxy. Avant une modification, valider la configuration Caddy et vérifier le DNS de l’API et du domaine de réception SMTP.

## 3. Activer les fonctions préparées

- **Bloom.** Publier le code et appliquer `0036` et `0037`. Vérifier que l’endpoint de téléchargement répond `401` sans jeton. Configurer les clés, publier un fichier `.bloom` signé depuis **Listes & suppressions** et vérifier son téléchargement depuis l’agent. Dans le conteneur actuel, utiliser le volume persistant `state` monté sur `/etc/kumo-agent` pour conserver l’instantané. Les unités systemd fournies sont destinées à un agent installé sur l’hôte. Pour Docker, planifier le rafraîchissement dans l’environnement du conteneur et lui fournir le fichier via le volume. La vérification exacte des suppressions demeure obligatoire.
- **DANE/TLSA.** Vérifier d’abord DNSSEC et le certificat SMTP réellement présenté. Configurer la cible autorisée dans Lovable puis tester `verify-smtp-tlsa.py` avant de planifier une publication. Les unités livrées sont des modèles. Une rotation de certificat et de clé demande une procédure coordonnée.
- **Relais DMARC.** `prochain-deploiement/worker.mjs` est le relais Cloudflare Email Worker. Configurer les secrets et la route de réception décrits dans [CODEX.md](../docs/CODEX.md), puis vérifier le parcours de rapport de bout en bout.

Pour tester le premier rafraîchissement Bloom dans l’image Docker mise à jour, utiliser les variables chargées par Compose. Planifier cette même commande depuis l’hôte après un premier succès.

```bash
docker compose -f compose.yaml -f prochain-deploiement/compose.agent-update.yaml exec -T sender \
  sh -c 'python3 -B /usr/local/lib/email-direct/suppression-bloom.py refresh "$SUPPRESSION_BLOOM_SNAPSHOT" "$SUPPRESSION_BLOOM_URL"'
```

## Intégrité et vérification finale

Sur Linux, lancer `cd reinstallation-lovable/vps && sha256sum -c SHA256SUMS` pour vérifier la copie d’origine. Après réinstallation, vérifier le statut des conteneurs, l’agent dans Lovable, le parcours Mail-Tester et un test sur boîtes témoins. Vérifier séparément chaque option activée. Ne lancer aucune campagne réelle tant que ces contrôles et les migrations attendues ne sont pas confirmés.
