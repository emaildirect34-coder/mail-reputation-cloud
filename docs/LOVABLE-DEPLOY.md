# Mise à jour d’Email Direct dans Lovable

Dépôt GitHub `emaildirect34-coder/mail-reputation-cloud`, branche `main`. Le commit GitHub synchronise le code avec l’éditeur Lovable. Vérifier séparément la base, les secrets, la publication et les VPS.

## Ordre de mise à jour

1. Vérifier la connexion GitHub et ouvrir la révision synchronisée dans le projet existant. Conserver l’historique publié.
2. Faire une sauvegarde de la base existante et comparer son historique à [la série de migrations SQL](../drizzle/migrations/). Appliquer **uniquement les migrations manquantes**, dans l’ordre numérique, jusqu’à **0046**. Sur une base vierge, appliquer la série complète **0000 à 0046** dans l’environnement Lovable Cloud. Un fichier présent sur GitHub ne prouve pas son exécution dans la base.
3. Vérifier les secrets existants dans Lovable Cloud. Pour Mail-Tester, utiliser `MAILTESTER_URL` et `MAILTESTER_KEY`. Pour les confirmations, configurer les deux clés distinctes `SUBSCRIPTION_CONFIRMATION_KEY` et `SUBSCRIPTION_PROOF_KEY` si la fonctionnalité est utilisée. Pour activer les rapports Gmail par campagne, définir `GMAIL_FEEDBACK_SENDER_ID` et vérifier le domaine DKIM dans Postmaster Tools. Les valeurs et prérequis des autres options figurent dans [CODEX.md](CODEX.md).
4. Publier depuis Lovable et confirmer que le compte superadmin retrouve ses listes, domaines et serveurs existants.
5. Mettre à jour les agents KumoMTA à partir de **l’installateur de la version Lovable publiée**. Utiliser la procédure Docker décrite dans le [dossier de réinstallation](../reinstallation-lovable/README.md), en gardant la file et les montages persistants. La copie du VPS dans ce dossier sert à la restauration et à la comparaison. Installer les options Bloom, DANE et relais DMARC séparément si elles sont utilisées.
6. Effectuer les vérifications ci-dessous sur une campagne et des boîtes témoins dédiées.

## Vérifications après publication

| Contrôle | Résultat attendu |
| --- | --- |
| **Vue d’ensemble** | Le cockpit se charge avec les données enregistrées. Les mesures sans échantillon restent vides. |
| **Deliverability Lab → Délivrabilité SMTP** | Le rapport possède sa propre page `/dashboard/logs/smtp`. Les périodes et l’impression PDF fonctionnent. Les droits héritent de **Logs & événements**. |
| **Nouvelle campagne → Test Inbox** | L’agent envoie aux boîtes témoins configurées. Le popup reçoit les résultats de placement. |
| **Nouvelle campagne → Envoi réel → Suivi** | Le placement témoin est rattaché à la campagne et séparé des acceptations SMTP. |
| **Files KumoMTA → À vérifier** | Un accusé d’injection perdu ne provoque pas un nouvel envoi automatique. Le rapprochement nécessite l’agent actualisé. |
| **Paramètres → Général** | Le plafond global 24 h ou 48 h est disponible. Il démarre désactivé. L’activer uniquement avec des agents compatibles. |
| **Serveurs** | Vérifier que l’agent rapporte la configuration appliquée et que les installations DKIM sont confirmées. |

Lovable Cloud garde PostgreSQL et les clés de service. Les VPS utilisent uniquement les API HTTPS documentées. Conserver les secrets hors du dépôt. Le Contacts Vault 149 Go et le multi-client restent hors périmètre.
