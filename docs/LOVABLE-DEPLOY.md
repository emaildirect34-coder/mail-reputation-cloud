# Mise à jour d’Email Direct dans Lovable

Dépôt GitHub `emaildirect34-coder/mail-reputation-cloud`, branche `main`. Le commit GitHub synchronise le code avec l’éditeur Lovable. Vérifier séparément la base, les secrets, la publication et les VPS.

## Ordre de mise à jour

1. Vérifier la connexion GitHub et ouvrir la révision synchronisée dans le projet existant. Conserver l’historique publié.
2. Faire une sauvegarde de la base et vérifier l’historique Lovable. Les changements Codex 0017 à 0026 ont été regroupés dans les migrations Lovable 0017 à 0019. Les scripts Codex 0027 à 0086 sont dans [drizzle/pending-codex](../drizzle/pending-codex/). Utiliser l’outil de migration Lovable pour appliquer **uniquement les scripts encore manquants**, dans l’ordre. Sur une base vierge, commencer par [drizzle/migrations](../drizzle/migrations/), puis appliquer les scripts en attente. Régénérer les types après application et vérifier les droits RLS ainsi que la compilation avant de publier.
3. Vérifier les secrets existants dans Lovable Cloud. Pour Mail-Tester, utiliser `MAILTESTER_URL` et `MAILTESTER_KEY`. Pour les confirmations, configurer les deux clés distinctes `SUBSCRIPTION_CONFIRMATION_KEY` et `SUBSCRIPTION_PROOF_KEY` si la fonctionnalité est utilisée. Pour activer les rapports Gmail par campagne, définir `GMAIL_FEEDBACK_SENDER_ID` et vérifier le domaine DKIM dans Postmaster Tools. Les valeurs et prérequis des autres options figurent dans [CODEX.md](CODEX.md).
   Pour le contrôle des liens du constructeur, configurez facultativement `CAMPAIGN_AUDIT_HOSTS` avec une liste séparée par des virgules des hôtes HTTPS de vos domaines ou CDN, par exemple `exemple.fr,images.exemple.fr`. Seuls ces hôtes seront sollicités; les redirections restent à vérifier manuellement.
4. Publier depuis Lovable et confirmer que le compte superadmin retrouve ses listes, domaines et serveurs existants.
5. Mettre à jour les agents KumoMTA à partir de **l’installateur de la version Lovable publiée**. Utiliser la procédure Docker décrite dans le [dossier de réinstallation](../reinstallation-lovable/README.md), en gardant la file et les montages persistants. La copie du VPS dans ce dossier sert à la restauration et à la comparaison. Installer les options Bloom, DANE et relais DMARC séparément si elles sont utilisées.
6. Effectuer les vérifications ci-dessous sur une campagne et des boîtes témoins dédiées.

## Vérifications après publication

| Contrôle | Résultat attendu |
| --- | --- |
| **Vue d’ensemble** | Le cockpit se charge avec les données enregistrées. Les mesures sans échantillon restent vides. |
| **Deliverability Lab → Délivrabilité SMTP** | Le rapport possède sa propre page `/dashboard/logs/smtp`. Les périodes et l’impression PDF fonctionnent. Les droits héritent de **Logs & événements**. |
| **Nouvelle campagne → Test Inbox** | L’agent envoie aux boîtes témoins configurées. Le popup reçoit les résultats de placement. |
| **Nouvelle campagne → Envoi réel → Serveur d’envoi** | Choisir un serveur, sauvegarder puis restaurer le brouillon. Vérifier que Test Inbox et la campagne programmée utilisent ce serveur et, le cas échéant, le pool VMTA choisi. Le serveur apparaît dans **Mes campagnes** pour les superadmins. |
| **Nouvelle campagne → Envoi réel → Suivi** | Avec « Tester avant d’envoyer », la campagne attend le test, puis une autorisation par fournisseur. Vérifier le placement témoin et les acceptations SMTP dans leurs colonnes respectives. |
| **Files KumoMTA → À vérifier** | Un accusé d’injection perdu ne provoque pas un nouvel envoi automatique. Le rapprochement nécessite l’agent actualisé. |
| **Paramètres → Général** | Le plafond global 24 h ou 48 h est disponible. Il démarre désactivé. L’activer uniquement avec des agents compatibles. |
| **Serveurs** | Vérifier que l’agent rapporte la configuration appliquée et que les installations DKIM sont confirmées. |

Lovable Cloud garde PostgreSQL et les clés de service. Les VPS utilisent uniquement les API HTTPS documentées. Conserver les secrets hors du dépôt. Le Contacts Vault 149 Go et le multi-client restent hors périmètre.

## Achats sponsors et remerciements

Après application de `0047_sponsor_buyers.sql`, ouvrez **Offres sponsors → Acheteurs confirmés** en Superadmin. Choisissez l’offre, saisissez la valeur exacte de l’événement d’achat, sélectionnez la liste d’abonnement volontaire et activez le remerciement. L’URL HTTPS de votre page d’avis peut être renseignée plus tard. Les liens déjà envoyés affichent la configuration courante de l’offre pendant leur période de validité de 180 jours. Si le site utilise un domaine de production différent de `https://mail-reputation-cloud.lovable.app`, définissez `PURCHASE_PUBLIC_ORIGIN` côté serveur avec l’origine publique HTTPS.

- **CAKE / CX3Ads**. Ajoutez `s2={click_id}` au lien de l’offre. Sur le postback de vente correspondant, utilisez `click_id=#s2#` et choisissez dans **Testing & Tracking → Tokens** l’identifiant unique de vente ou de conversion à envoyer dans `txid`. [Documentation CAKE](https://support.getcake.com/support/solutions/articles/5000546096)
- **Everflow**. Ajoutez `sub1={click_id}` au lien de l’offre. Dans le postback propre à l’offre, utilisez `click_id={sub1}` et `txid={transaction_id}` si cet identifiant est unique pour chaque achat. Utilisez `event_id={event_id}` si la macro est disponible pour cet événement. [Documentation Everflow](https://helpdesk.everflow.io/collaborator/managing-postbacks-as-a-partner)
- Utilisez l’URL privée générée pour le compte sponsor dans le tableau de bord. Le callback doit inclure l’identifiant du clic, `txid`, `event` ou `event_id`, et un `status` explicite. Une valeur fixe telle que `event=purchase&status=approved` convient à un callback dédié qui se déclenche uniquement sur une vente effectivement confirmée. Configurez un éventuel callback d’annulation avec le même clic et la même transaction, et `status=refunded` ou `status=rejected`. Vérifiez les macros et le déclencheur avec une commande de test du réseau.
- Le remerciement est mis en file sur le serveur et le pool de la campagne source. L’agent doit publier `preferencePermit` et utiliser la demande d’autorisation d’injection existante. Pour un essai de bout en bout, utilisez une boîte de test, déclenchez le postback de vente deux fois, vérifiez un seul message, puis testez le lien d’avis et le formulaire d’abonnement.

La migration `0048_stop_sponsor_followups.sql` arrête les relances du destinataire pour **la même offre sponsor**. Une vente confirmée écarte les messages encore en attente d’autorisation d’injection. Le lancement de campagne écarte aussi les acheteurs déjà confirmés. Les exclusions apparaissent dans la colonne **Exclus**, avec le motif dans la trace du message. Un remboursement rend à nouveau le contact éligible aux prochaines campagnes si toutes les autres règles le permettent. Une relance précédemment écartée reste écartée.

Pour valider, préparez une relance planifiée pour la boîte de test et la même offre, puis confirmez l’achat. Vérifiez l’exclusion de la relance et la mise en file du remerciement. Vérifiez également qu’une autre offre reste éligible. Les campagnes sponsor exigent un agent compatible `preferencePermit`. La dernière vérification intervient à l’autorisation d’injection. Un message ayant déjà reçu cette autorisation peut être envoyé.

La migration `0055_sponsor_brand_preferences.sql` ajoute **Marque de l’offre** dans **Offres sponsors → Acheteurs confirmés**. Associez chaque offre concernée à une marque et réutilisez la même entrée pour les offres de cette marque sur différents réseaux. La page après achat et le centre de préférences affichent les marques liées au destinataire. Un blocage s’applique à la préparation de l’audience et à l’autorisation d’injection des messages encore en file. Retirer un blocage rétablit l’éligibilité selon les autres préférences et consentements déjà enregistrés.

## Priorité et reprise de la file de campagnes

Appliquer `0056_campaign_priority_and_capacity.sql` puis `0057_confirmed_campaign_retry.sql`. Choisir la priorité **Haute**, **Normale** ou **Basse** dans **Envoi réel**, ou la modifier dans **Mes campagnes → Suivi**. Le suivi permet aussi de fixer un plafond commun aux campagnes d’un serveur. Ce plafond compte les messages pris en charge par l’agent sur une fenêtre glissante de 60 secondes. Un plafond vide désactive cette limite. Le suivi indique quand une campagne attend une campagne prioritaire ou quand le plafond du serveur est atteint.

Dans le suivi, **Reprendre les envois confirmés comme non partis** crée une nouvelle tentative après un refus explicite d’injection de KumoMTA. Les désabonnements, achats et préférences sont revérifiés à la remise en file puis à l’autorisation d’injection. Les envois au résultat incertain restent en attente de vérification. Une confirmation tardive de réception par KumoMTA bloque une nouvelle tentative encore en file.

## Maintenance d’un serveur d’envoi

Appliquer `0058_server_maintenance.sql` et mettre à jour l’agent KumoMTA depuis l’installateur publié. Depuis **Vue d’ensemble → Maintenance des serveurs**, sélectionner le serveur et cliquer sur **Mettre en maintenance**. Ses nouveaux messages de campagne attendent dans Email Direct avec un motif visible dans le suivi. Les messages déjà pris en charge par l’agent ou par KumoMTA suivent leur cycle normal. Les autres serveurs continuent à envoyer.

Attendre **Prêt pour le redémarrage**. Cet état exige zéro message en cours de remise à l’agent et une mesure KumoMTA à zéro reçue pendant la maintenance dans les deux dernières minutes. Le redémarrage se fait sur le VPS. Cliquer ensuite sur **Rouvrir les envois** pour que l’agent reprenne les messages sur le même serveur. [Métriques KumoMTA](https://docs.kumomta.com/reference/metrics/kumod/message_count/)

## Validation des campagnes programmées

Appliquer `0059_scheduled_campaign_approval.sql` et mettre à jour les agents KumoMTA avec l’installateur publié. La migration place les campagnes programmées existantes en attente d’une première validation pour les messages qui restent à remettre. Dans **Mes campagnes → Suivi**, examiner la version actuelle puis cliquer sur **Valider cette version**. Pour une nouvelle campagne, **Valider et programmer** enregistre la validation au moment de la programmation.

Une modification de l’objet, du contenu, de l’expéditeur, du lien de l’offre sponsor, de l’audience ou du serveur rend la validation précédente caduque. Le suivi affiche les champs à vérifier et la configuration actuelle. Les contrôles de désabonnement et les autres exclusions d’envoi peuvent continuer à retirer des destinataires de la sélection approuvée. Les messages qui ont déjà obtenu l’autorisation d’injection suivent leur cycle. Après validation, reprendre séparément une campagne suspendue manuellement.

## Prévision des conflits d’audience

Appliquer `0060_campaign_audience_conflicts.sql`. Dans **Nouvelle campagne → Envoi réel**, renseigner la liste, le serveur et la date, puis cliquer sur **Vérifier les chevauchements**. Le calcul réutilise la sélection de lancement, l’étalement et les fuseaux de la campagne. Il affiche les destinataires communs uniques, puis les estimations de report par campagne selon le plafond global de 24 ou 48 heures. Si le plafond est désactivé, le rapport affiche les chevauchements à 24 heures de part et d’autre.

À heure prévue égale, la priorité s’applique aux messages qui attendent sur le même serveur. Sur des serveurs différents, le rapport indique que l’ordre est incertain. Le résultat compare les messages encore en file ou en remise à l’agent. Il peut évoluer avec la disponibilité des serveurs et les pauses des campagnes.

## Historique des versions de campagne

Appliquer `0061_campaign_version_history.sql`. Dans **Mes campagnes → Suivi → Historique des versions**, le superadmin peut comparer deux versions du contenu et de la configuration, voir les liens ajoutés ou retirés et ouvrir une version dans le brouillon. Les campagnes existantes reçoivent une première archive de leur état à la date de migration. L’archive conserve la configuration et le contenu, avec la référence de la liste, et reste dans Lovable Cloud.

La restauration charge le contenu et l’expéditeur en mode test. Choisir à nouveau la liste, le serveur et la date. Une offre dont le lien a changé ou qui est devenue indisponible demande une nouvelle sélection. Pour un ancien récapitulatif dont les rubriques ne peuvent pas être reproduites, le brouillon affiche le HTML archivé et signale le format à vérifier.

## Date limite d’envoi

Appliquer `0062_campaign_send_deadline.sql`. Dans **Nouvelle campagne → Envoi réel**, la **Date limite d’envoi** est facultative et utilise le fuseau du compte. Elle doit suivre le départ programmé. À l’échéance, un message encore en attente d’autorisation devient **Expiré**. Le suivi et la trace distinguent cet état d’un échec SMTP. Les messages déjà autorisés peuvent encore être remis ou livrés par KumoMTA.

L’échéance est vérifiée à la prise en charge et à l’autorisation d’injection. Le passage en base à l’état **Expiré** est traité par les agents, le suivi et l’appel périodique authentifié à `/api/public/jobs/incident-notifications`. Ce dernier permet de traiter les expirations même quand les agents sont hors ligne.

## Alerte de campagne en double

Appliquer `0063_campaign_duplicate_review.sql` avant de publier. Quand le superadmin lance ou programme un envoi, Email Direct compare l’audience retenue avec les campagnes qui ont le même contenu HTML ou la même offre sponsor. Le contrôle couvre les messages encore en file, y compris à des dates différentes, ainsi que les envois pris en charge au cours des 30 derniers jours. La comparaison traite les retours à la ligne Windows et Unix de la même manière.

Si des destinataires sont communs, la fenêtre affiche le total unique et le détail par campagne. **Revoir la campagne** revient au brouillon. **Confirmer et programmer** ou **Confirmer et lancer** refait le contrôle avant la mise en file. Une modification du brouillon ou du chevauchement exige une nouvelle confirmation. Deux préparations concurrentes avec le même contenu ou la même offre sont contrôlées à tour de rôle.

## Bilan des écarts après campagne

Appliquer `0064_campaign_delivery_reconciliation.sql`. Dans **Mes campagnes → Suivi → Bilan des écarts**, le rapport compare le volume prévu aux messages acceptés au moins une fois en SMTP. Il répartit le solde entre la file, les confirmations d’injection, les reports et rebonds SMTP, les expirations et les exclusions. Les contacts écartés avant la mise en file sont affichés séparément.

Chaque message d’origine est compté une fois, y compris en cas de nouvelle tentative. Une acceptation SMTP enregistrée reste comptée après un rebond ou une plainte. Si le volume prévu diffère des messages retrouvés dans la file, le bilan signale la différence. Le superadmin peut l’actualiser depuis le suivi.

## Centre d’incidents

Appliquer `0065_operations_incident_center.sql`, puis ouvrir **Cockpit → Incidents**. Le centre recense les campagnes bloquées, les injections à vérifier et les agents indisponibles. Les maintenances déclarées écartent l’alerte d’agent indisponible pour le serveur concerné. Le superadmin peut ouvrir le suivi des campagnes touchées ou la fiche du serveur.

Le superadmin assigne les incidents aux comptes habilités. Pour habiliter un collaborateur, ajouter **Centre d’incidents** à une tâche active. Le collaborateur voit et résout les incidents qui lui sont assignés. Le superadmin peut rouvrir le suivi. La résolution enregistrée et l’état du signal sont affichés séparément dans l’historique.

Le centre est alimenté par l’appel périodique authentifié à `/api/public/jobs/incident-notifications` et par l’ouverture ou l’actualisation de la première page des incidents à traiter par un superadmin.

## Plafond journalier par domaine expéditeur

Appliquer `0066_sender_domain_daily_quota.sql`. Dans **Domaines → Détails du domaine → Plafond journalier du domaine**, le superadmin règle le plafond ou laisse le champ vide pour le désactiver. Le compteur est commun aux VPS et aux campagnes d’un même domaine exact dans le champ **From**. Chaque sous-domaine dispose de son propre compteur.

Le compteur se remet à zéro à **00 h UTC**. Il comptabilise les autorisations d’injection des campagnes et des remerciements après achat. Une autorisation conserve sa place même si le résultat de l’injection est incertain. La migration reprend les autorisations de la journée encore enregistrées dans la file. Au plafond, les prochains messages attendent et le suivi indique la limite du domaine. La reprise intervient à la prochaine lecture de file après remise à zéro ou relèvement du plafond, selon les protections et échéances de la campagne.

## Prévision de saturation par domaine

Appliquer `0067_sender_domain_quota_forecast.sql`. Pour une campagne programmée, ouvrir **Nouvelle campagne → Envoi réel → Prévoir le quota du domaine**. Le calcul reprend le domaine expéditeur, le plafond actif, les autorisations déjà utilisées et la file de tous les VPS. Il utilise les fuseaux, l’étalement et la date limite du brouillon. Le résultat présente les places estimées par jour UTC, les reports du brouillon et les expirations possibles.

La projection réserve d’abord les places à la file déjà enregistrée. Elle couvre jusqu’à sept jours après le dernier créneau prévu et signale le solde au-delà. Les pauses et les plafonds par serveur peuvent modifier le départ réel.

## Profils expéditeur

Appliquer `0068_verified_sender_profiles.sql` et publier l’application. Ouvrir **Domain & Auth → Profils expéditeur** avec un compte superadmin. Créer un profil avec le nom affiché, l’adresse d’expédition et, si nécessaire, une adresse de réponse. Sélectionner un serveur KumoMTA en ligne sur lequel le domaine d’expédition est installé et qui prend en charge l’autorisation d’injection. Envoyer puis saisir le code reçu pour chaque adresse distincte. Le code expire après 15 minutes et est limité à cinq tentatives. Un nouvel envoi est possible après une minute.

Dans le créateur de campagne, sélectionner le profil vérifié pour remplir les champs d’expédition et de réponse. Le serveur retenu pour la campagne ou son test inbox doit avoir ce domaine installé. Une adresse modifiée doit être vérifiée à nouveau. Le code est rendu dans le message remis à l’agent via l’API existante de la file.

## Surveillance et rapprochement sponsor

Appliquer `0069_sponsor_monitoring_and_reconciliation.sql`, publier l’application et vérifier l’appel périodique authentifié à `/api/public/jobs/incident-notifications`. Renseigner les hôtes exacts approuvés dans `SPONSOR_AUDIT_HOSTS`. **Offres sponsors → Surveillance des liens après envoi** affiche les contrôles HEAD toutes les six heures jusqu’à 30 jours après la dernière injection. La sonde utilise un identifiant fictif et contrôle les liens sponsor identifiables dans le HTML, jusqu’à dix par campagne. Une redirection hors liste est signalée avant toute requête vers cet hôte. Un changement par rapport au premier domaine final observé et les réponses refusées ou indisponibles sont signalés. Les canaux Telegram et WhatsApp déjà configurés reçoivent une alerte par période d’incident.

Dans **Finances & revenus → Rapprochement des conversions sponsor**, sélectionner les dates UTC (31 jours maximum), l’offre et la campagne. En tant que superadmin, coller la colonne des identifiants de transaction des achats confirmés, un identifiant par ligne sans en-tête, ou confirmer que le rapport est vide. Réimporter la même campagne et la même période remplace le rapport. Le tableau compare les références exactes avec les postbacks de ce compte et met en évidence les absences, différences de statut et erreurs d’attribution. Pour les achats présents seulement dans Email Direct, la période correspond au jour UTC de réception initiale du postback. Le rapport laisse les écritures et les acheteurs intacts.

## Diagnostic, cockpit et segmentation

- **0070** — Dans **Offres sponsors**, créer un lien de diagnostic temporaire et faire appeler son URL de test par le réseau. Le diagnostic emploie un identifiant fictif et son propre jeton. Le journal des refus de production n’enregistre ni jeton ni adresse. L’appel quotidien authentifié nettoie les entrées de plus de 30 jours. Dans **Finances**, charger un CSV, choisir ses colonnes et vérifier les références avant de confirmer l’import. Les correspondances CSV sont mémorisées dans le navigateur. Le dossier des écarts s’exporte en JSON.
- **0071** — Le cockpit affiche les messages arrivés à leur créneau et encore en attente d’autorisation, le planning sur 24 heures et l’état observé des agents. Dans les offres, les mesures sur 90 jours utilisent les confirmations reçues. L’objectif journalier UTC est un indicateur interne. Il peut différer du quota du sponsor.
- **0072** — Dans **Mes campagnes**, gérer les dates sans envoi marketing en UTC. Le calendrier s’applique à la file Email Direct et à l’autorisation d’injection. Vérifier que les agents annoncent `preferencePermit` avant de configurer des jours futurs. Un message déjà injecté dans KumoMTA suit sa file SMTP. Le suivi de chaque campagne contient le carnet d’hypothèses, d’observations et de décisions.
- **0073** — Dans **Listes & suppressions**, utiliser la fiche par adresse exacte et les rapports par liste. Les motifs de désinscription restent facultatifs et s’affichent après la confirmation manuelle. Les avis après achat sont facultatifs et indépendants du consentement marketing. Les cohortes sont regroupées par mois d’ajout à la liste. Les dates de consentement proviennent des preuves enregistrées.
- **0074** — Dans **Listes & suppressions**, choisir une liste puis comparer un segment avant de l’enregistrer. Dans **Nouvelle campagne → Envoi réel**, sélectionner cette liste et le segment. Le filtre s’applique au calcul de l’audience et au lancement. Les protections et suppressions habituelles sont toujours évaluées. Les nombres de l’aperçu comptent les contacts actifs et non supprimés.
- **0075** — **Profils expéditeur** permet de générer un canal de réponses à jeton révocable, consulter les réponses remontées par un connecteur et les marquer traitées. Le tableau de bord ne se connecte pas directement aux boîtes : configurer un connecteur de réception autorisé pour poster le `In-Reply-To`, une référence de source et l’horodatage à `/api/public/sender-replies`. Le canal est révoqué si l’adresse du profil change.
- **0076** — Dans **Campagnes**, comparer les données de deux campagnes terminées ou suspendues. Les plaintes et désabonnements sont des événements observés; ouvertures et clics peuvent inclure des proxys/scanners et ne prouvent pas une lecture humaine. Dans **Mes campagnes**, la checklist de fin est créée à la clôture et peut être annotée et suivie.
- **0077** — Dans le constructeur, **Modèles enregistrés et blocs réutilisables** conserve les courriels avec historique de versions et permet de restaurer une version en créant une nouvelle entrée d’historique. Les blocs HTML sont stockés pour le compte privé et ajoutés au brouillon à la demande; vérifie chaque rendu avant envoi.
- **0078** — Corrige l’A/B : la partie non affectée aux variantes reste en attente pendant le test. Après l’heure prévue et au moins un envoi tenté pour chaque variante, l’agent choisit automatiquement la meilleure selon le critère configuré, puis les messages restants utilisent cette variante. Le bouton de décision anticipée exige désormais au moins un envoi de chaque version.
- **0079** — **Serveurs → Moteur KumoMTA → Historique des configurations** affiche les changements d’empreinte de configuration. Il conserve uniquement le hash et sa date; les contenus privés ne sont pas archivés.
- **0080** — Le **Centre d’incidents** affiche le dernier résultat observé des tâches quotidiennes protégées. Le planificateur reste externe et doit continuer à appeler `/api/public/jobs/daily-report` et `/api/public/jobs/incident-notifications` avec son secret.
- **0081** — Dans la **Fiche contact**, exporter les informations et preuves disponibles en JSON, ou demander l’effacement en recopiant l’adresse exacte. L’opération retire les listes et préférences, anonymise les destinataires historiques et invalide leurs liens. Le hash de suppression reste conservé pour empêcher une réimportation; les écritures financières sponsor demeurent pour audit comptable. Configure la politique de sauvegarde/rétention de la base dans les réglages gérés de Lovable Cloud : l’application ne peut pas administrer directement les sauvegardes de PostgreSQL.
- **0082** — **Centre des opérations** rassemble l’état de la base, du Mail-Tester, des agents et des tâches planifiées connues. Le rapport hebdomadaire est imprimable en PDF. Le journal conserve les actions campagne, incident et modèle enregistrées après cette migration. Le Mail-Tester est sondé côté serveur; ses secrets ne sont jamais envoyés au navigateur.
- **0083** — Les nouveaux lancements enregistrent les exclusions par motif et un MD5 du contact, sans recopier son adresse dans cette table. **Mes campagnes** permet aux superadmins de télécharger les adresses encore présentes dans le carnet de contacts et leur motif; l’export est journalisé. Les contacts supprimés sont représentés par leur hash.
- L’agent mis à jour remonte le pourcentage d’espace utilisé sur son volume Kumo. Cette mesure est indicative pour le chemin monté par le conteneur; surveille séparément les volumes et l’espace de l’hôte.

## Contrôle de délivrabilité avant envoi

Appliquer les migrations 0049 à 0054, publier l’application, mettre à jour l’agent KumoMTA et redéployer le service `placement.py` de Mail-Tester en conservant son volume et sa clé de chiffrement. Les boîtes Gmail intégrées reconnaissent `mx.google.com`. Pour les autres boîtes, renseigner `authserv` dans le fichier privé `/etc/mailtester/seeds.yml` avec les identifiants observés dans les en-têtes `Authentication-Results` de leurs serveurs récepteurs. Un suffixe de confiance peut commencer par un point. Les résultats inconnus laissent le lot en attente.

- Le contrôle utilise un serveur sélectionné et son pool. Le témoin reçoit le même objet, avec une référence dans `X-Email-Direct-Placement`. La preuve de désinscription exerce l’opération de production en base sur une adresse synthétique, puis efface cette donnée dans la transaction du test. Le suivi de campagne déclenche également le POST RFC 8058 public depuis le navigateur en HTTPS, vérifie le retrait d’un message synthétique de la file et nettoie les données de test. Une vérification réussie est requise pour autoriser le fournisseur.
- Un administrateur autorise chaque fournisseur depuis le suivi lorsque les témoins sont en réception ou en Promotions et que SPF, DKIM, DMARC et la signature de désinscription sont vérifiés. Un fournisseur sans témoin reste en attente. Le premier lot est plafonné à 25 contacts.
- Avec la migration `0052_observed_campaign_waves.sql`, les nouveaux lots s’ouvrent par fournisseur à partir des résultats SMTP réels du lot précédent. Après la dernière injection, le système attend au moins dix minutes et exige 90 % d’acceptations SMTP (avec au moins cinq acceptations ou la totalité pour un petit lot), au plus 10 % de reports encore actifs, au plus 5 % de rebonds, aucune plainte reçue sur les lots ouverts et des résultats témoins valides de moins de 24 heures. Le suivi indique le motif d’attente. Les agents existants utilisent déjà la file qui applique ce contrôle. Les lots autorisés avant la migration conservent leur programmation.
- Les retours Gmail `4.7.28`, Outlook `5.7.515` et Orange `OFR…_104` suspendent la destination concernée pour le domaine expéditeur. L’agent synchronise les suspensions des files programmées KumoMTA. Pour Outlook, corriger l’authentification et autoriser le lot après un nouveau témoin reçu et validé. Tester ces réactions sur un lot interne avant de les exploiter en volume.
- Pour l’audit des offres, définir `SPONSOR_AUDIT_HOSTS` côté serveur avec les noms d’hôtes HTTPS exacts approuvés. Le contrôle suit les redirections autorisées avec des requêtes HEAD. Un hôte inconnu ou une destination qui refuse HEAD requiert une vérification manuelle. Les rapports par liste et par offre comptent les événements observés sur sept jours. La liste d’envoi sert de source d’audience.
- La migration 0053 attend une remontée du lecteur de journaux KumoMTA couvrant les cinq dernières minutes pour ouvrir un lot suivant. Mettre à jour le script d’événements des agents. Le suivi affiche l’heure de la lecture, la couverture annoncée et le dernier événement reçu. Une campagne peut aussi définir une plage horaire quotidienne, y compris une plage qui traverse minuit. Le contrôle s’applique aux messages encore dans la file Email Direct, à l’heure du destinataire ou dans le fuseau du compte si celui du contact manque.

- **0084** — Factures fournisseurs séparées, reprises persistantes des webhooks et snapshots d’expiration des certificats Cloudflare. Programmer le job POST /api/public/jobs/webhook-retries toutes les 5 minutes avec l’authentification Cron existante.
- **0085** — Historique/restauration des enregistrements DNS gérés, rapprochement des paiements de factures, durées de réponse webhook, export CSV d’audit, alertes de campagne sans progression et surveillance récurrente des certificats Cloudflare via le job `incident-notifications`.
- **0086** — Décision A/B avec minimum statistique et version A de secours si le résultat n’est pas concluant, brief éditorial privé pour les campagnes programmées, historique des tests témoins et vérification préalable des liens/images pour les hôtes HTTPS autorisés.
