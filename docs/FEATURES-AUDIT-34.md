# Audit des 34 pistes produit

État du dépôt au 12 novembre 2026. « Présent » signifie que le parcours ou la protection existe dans le code du projet. Les fonctionnalités qui exigent le VPS, Lovable Cloud, un compte tiers ou des données de production sont indiquées comme telles : leur présence dans le code ne prouve pas leur activation en production.

| # | Piste | État | Observation |
|---:|---|---|---|
| 1 | Santé des serveurs et alertes d’exploitation | Présent / partiel | État agents, incidents et notifications applicatives disponibles. Il faut un ordonnanceur externe actif pour les tâches récurrentes. |
| 2 | Détection des écarts de configuration Kumo | Présent | Hash de configuration souhaité/appliqué et historique des révisions; les clés privées ne sont pas archivées dans l’historique. |
| 3 | Reprise après incident et réconciliation des envois | Présent | Réconciliation et reprise des seuls résultats confirmés comme non partis; les résultats ambigus ne sont pas rejoués aveuglément. |
| 4 | Protection contre les doublons de campagne | Présent | Contrôle et revue des conflits avant lancement. |
| 5 | Priorité et capacité des campagnes concurrentes | Présent | File, capacité et raison d’attente visibles dans le suivi. |
| 6 | Maintenance des serveurs d’envoi | Présent | État de maintenance intégré au contrôle agent et au routage. |
| 7 | Plafonds et prévisions de quota d’envoi | Présent | Quotas de domaines expéditeurs et prévision calculée à partir des données disponibles. |
| 8 | Approbation des campagnes planifiées | Présent | Contrôle préalable avant lancement d’une campagne programmée. |
| 9 | Fenêtres et échéances d’envoi | Présent | Horaire d’envoi et échéance intégrés au planificateur. |
| 10 | Sélection du serveur d’envoi par campagne | Présent | Profil serveur sélectionnable et injecté dans le flux de campagne. |
| 11 | Fraîcheur des signaux SMTP et suivi des vagues | Présent | Évite de traiter une télémétrie périmée comme une observation actuelle. |
| 12 | Préflight, qualité d’audience et exclusions | Présent / partiel | Garde-fous avant lancement et exclusions agrégées. Aucun service ne peut certifier qu’une adresse est un spamtrap. |
| 13 | Règles d’hygiène et domaines probablement mal saisis | Présent / partiel | Anomalies syntaxiques, rôles et typos connus détectables; il ne s’agit pas d’une vérification de boîte ni d’une preuve de piège. |
| 14 | Prévisualisation de segment avant envoi | Présent | Estimation et conflits d’audience visibles avant injection. |
| 15 | Historique de versions des campagnes | Présent | Versions enregistrées et consultables. |
| 16 | Tests A/B avec groupe témoin | Présent | Décision automatique après tentatives par variante, plus contrôle pour la décision manuelle. Pas d’intervalle de confiance statistique pour l’instant. |
| 17 | Comparaison des résultats de campagnes | Présent | Comparaison basée sur événements mesurés, pas sur une estimation d’inbox. |
| 18 | Attribution sponsor et postbacks | Présent / dépendant du partenaire | Liens et conversions suivis lorsque le sponsor transmet un postback exploitable. Sans postback, le clic ne prouve pas un achat. |
| 19 | Rapprochement financier sponsor | Présent | Import, diagnostic, déduplication et états financiers séparés. Les données financières conservées sont distinctes des préférences de contact. |
| 20 | Parcours après achat et consentement | Présent / dépendant du partenaire | Merci, avis et choix de consentement préparés; le postback doit être configuré et l’acheteur doit accepter séparément les offres. |
| 21 | Préférences, fréquence et pause des contacts | Présent | Centre de préférences et règles appliquées au flux d’envoi. |
| 22 | Modèles, blocs et historique de versions | Présent | Bibliothèque de modèles persistante avec snapshots restaurables. |
| 23 | Accessibilité du contenu e-mail | Présent / partiel | Vérifications statiques; cela ne remplace pas des rendus réels dans Outlook, Gmail et Apple Mail. |
| 24 | Détection d’anomalies de campagne et incidents | Présent / partiel | Protections et signaux opérationnels déjà disponibles; pas de modèle prédictif général entraîné sur l’historique. |
| 25 | Segments et analyses des contacts | Présent | Informations dérivées des événements captés; les ouvertures peuvent être faussées par les proxys et ne sont pas une preuve certaine de lecture. |
| 26 | Export de données d’un contact | Présent | Export JSON exact via service protégé. |
| 27 | Effacement des données de contact | Présent, migration requise | Anonymise les messages conservés, efface les préférences et retire le contact. Un MD5 de suppression est conservé pour empêcher sa réimportation; les écritures financières restent conservées. |
| 28 | Consentement après achat | Présent / migration requise | Consentement distinct enregistré avec liste, catégories et cadence, uniquement après action explicite de la personne. |
| 29 | Contrôle d’état de tâches récurrentes | Présent / partiel | Le suivi couvre les tâches applicatives instrumentées; il ne crée pas l’ordonnanceur externe. |
| 30 | Calendrier éditorial des campagnes | Présent / partiel | Vue des campagnes planifiées et notes disponibles; pas de workflow complet de brief, propriétaire et validation éditoriale. |
| 31 | Tâches de bilan après campagne | Présent | Liste de suivi et actions créées pour les campagnes terminées. |
| 32 | Résultats par campagne et indicateurs mesurés | Présent | Les statistiques distinguent l’acceptation SMTP de l’emplacement inbox. |
| 33 | Alertes automatiques de bilan aux membres de l’équipe | Partiel | Le bilan hebdomadaire est maintenant disponible dans le Centre des opérations et imprimable en PDF. L’envoi automatique par e-mail interne n’est pas activé. |
| 34 | Placement inbox par boîtes témoins | Présent / dépendant du VPS | L’interface et le contrat existent; la vérification réelle dépend du Mail-Tester, des comptes seeds et de leur configuration VPS. |

## Points à terminer avant de qualifier l’ensemble de « production »

1. Appliquer les migrations `0047` à `0083` dans l’environnement Lovable Cloud, puis exécuter les parcours de bout en bout avec les services configurés. Elles ne sont pas appliquées par une compilation locale.
2. Configurer et surveiller l’ordonnanceur externe pour les routes de rapports et notifications; vérifier son secret, sa fréquence et ses journaux.
3. Vérifier sur le VPS la version installée de l’agent Kumo, les seeds IMAP, les comptes de test et l’accusé de réception de télémétrie. Le rapport de disque agent couvre le volume de travail monté, pas nécessairement tout le disque hôte.
4. Ajouter un test d’accessibilité des URL d’images et de liens externes avant campagne et un rendu automatisé multi-clients si ces contrôles sont requis.
5. Ajouter un export détaillé des contacts exclus et de leur motif, des fenêtres d’attribution configurables, un indicateur de valeur à vie seulement si les achats peuvent être reliés légalement et de façon fiable, et un calcul de significativité pour les tests A/B.
6. Configurer une politique de sauvegarde et faire un exercice de restauration depuis l’interface d’administration Lovable Cloud. La sauvegarde PostgreSQL est gérée par Lovable Cloud, pas par les fonctions applicatives de ce dépôt.
7. Décider si le récapitulatif interne post-campagne et le calendrier avec propriétaires/briefs sont nécessaires à l’usage privé de l’équipe.

## Ajouts de la passe suivante

- **Centre des opérations** : vérifie la base via une lecture réelle, teste Mail-Tester depuis le serveur applicatif, montre la fraîcheur des agents et les dernières exécutions cron connues.
- **Journal d’audit** : enregistre les actions de campagne, incident et modèles réalisées après activation de la migration 0082. Il ne reconstitue pas le passé; d’autres mutations d’administration devront être branchées au journal progressivement.
- **Récapitulatif hebdomadaire** : lit les campagnes, les messages, les événements SMTP et les incidents réellement enregistrés sur sept jours glissants. L’acceptation SMTP est clairement distincte d’une présence en inbox.
- **Exclusions de campagne** : les nouveaux lancements enregistrent le motif et le hash du contact. L’export des adresses encore disponibles est réservé au superadmin et journalisé.
- **Contrôles additionnels** : vérification à la demande des jetons Cloudflare, état de connexion OAuth Postmaster, coûts déclarés par serveur et intervalle de confiance indicatif pour les tests A/B.
- **Exercice de restauration** : checklist locale guidée pour un essai manuel dans Lovable Cloud. Elle ne déclenche pas la restauration et ne prouve pas qu’une sauvegarde est restaurable.
- **Compatibilité e-mail** : aperçu stylisé et avertissements statiques pour Gmail, Outlook et Apple Mail. Aucun moteur réel de rendu client n’est connecté.

## Validation locale

La compilation TypeScript, la suite de tests et le build vérifient le code applicatif. Ils ne valident ni l’exécution des migrations sur PostgreSQL Lovable, ni les identifiants tiers, ni les réponses réelles des VPS/FAI. Les statistiques restent vides tant qu’aucun événement réel n’a été ingéré; aucune donnée de démonstration n’est présentée comme donnée de production.
