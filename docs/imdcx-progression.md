# Progression compétitive IMDCX

Cette mise à jour ajoute un classement global, hebdomadaire et entre amis, un profil personnalisable, les niveaux XP, les succès et les récompenses quotidiennes. Le moteur de poker et la présentation des tables restent ceux de l’application existante.

## Accès

- **Classement** sur l’accueil : podium, classement et statistiques personnelles.
- **Avatar** ou **Niv. …** : profil, cadres, titres et liste d’amis.
- **Défis du jour** : connexion quotidienne, trois missions et journal des gains.
- Une finale gagnée, une roue disponible ou un choix de multiplicateur en attente peuvent être repris depuis l’accueil ou le profil.

Les joueurs du podium proviennent des données du serveur. Les noms et scores de démonstration utilisés pour les captures de contrôle ne sont jamais ajoutés aux données réelles.

## Règles

| Résultat | Points de base | XP de partie |
| --- | ---: | ---: |
| Élimination d’une table de 10 joueurs | 0 | 40 |
| Deuxième de la table | 10 | 70 |
| Vainqueur de la table | 30 | 120 |
| Défaite en finale de championnat | 0 | 30 |
| Victoire en finale de championnat | 50 | 130 |
| Bataille réelle perdue | 0 | 20 |
| Bataille réelle gagnée | 2 | 50 |

Le vainqueur de la table ne cumule pas les 10 points de deuxième place : une table puis une finale gagnées rapportent **30 + 50 = 80 points de base**. Les succès, missions et niveaux ajoutent leurs propres récompenses, indiquées séparément dans le journal.

Le multiplicateur actif s’applique à ces points compétitifs, y compris aux 2 points de bataille déjà présents dans l’application. Une défaite au poker retire ce multiplicateur après le calcul des éventuels points de deuxième place. Les points acquis restent conservés. Les batailles perdues n’effacent pas le multiplicateur de poker.

Seules les tables démarrées avec 10 participants distincts et les duels marqués `isChampionshipFinal` produisent les résultats de championnat. Les tables d’entraînement, parties forcées avec moins de joueurs et aperçus ne produisent pas de progression compétitive. En cas d’éliminations simultanées dans la dernière main, la deuxième place revient au plus gros tapis au début de cette main ; égalité départagée par le numéro de siège.

La roue du nouveau brief propose **x1 / x2 / x5 / x10**, avec des poids serveur 30 / 40 / 20 / 10. Un ancien x3 actif est conservé jusqu’à son remplacement ou sa perte. Une victoire complète donne un seul tirage. Si un nouveau résultat diffère du multiplicateur actif supérieur à x1, le joueur choisit de conserver ou remplacer. Le résultat et le choix en attente survivent aux rechargements.

Les XP sont séparés des points et de l’ancienne échelle de crédits Q1/Q2/T1… Il faut 200 XP pour passer du niveau 1 au niveau 2, puis 50 XP supplémentaires par niveau. Chaque nouveau niveau rapporte **10 points non multipliés**. Paliers cosmétiques : Rookie (1), Challenger (10), Strategist (25), Legend (50), IMDCX Master (100). Des succès accordent également des XP et un cadre de champion.

Missions quotidiennes : trois batailles réelles (150 XP), une victoire en bataille (100 XP), trois victoires consécutives en bataille (300 XP). Les récompenses se récupèrent explicitement une seule fois. Connexion quotidienne : 50, 75, 100, 125, 150, 200, 300 XP sur sept jours ; la série recommence au premier jour après une journée manquée. Les journées changent à **00 h UTC**, les semaines le **lundi à 00 h UTC**. Les points globaux ne sont jamais remis à zéro par le classement hebdomadaire.

## Fichiers et données

- `lib/progression.js` : règles, migration, classement, missions, XP, cosmétiques.
- `lib/competitive-settlement.js` : règlement des éliminations et des victoires, tickets de finale et déduplication.
- `lib/progression-sockets.js` : API Socket.IO avec réponses et validation.
- `server.js` : branchement aux résultats réels et sauvegarde.
- `poker-app/static/js/progression-ui.js` et `static/css/progression.css` : écrans de progression isolés du jeu.
- `poker-app/static/js/client.js` et `poker-app/poker.html` : accès depuis l’accueil et raccordement aux événements.

La progression est stockée dans `playerLevels.json`, sous `progression` pour chaque joueur. Les points, multiplicateurs et crédits existants sont conservés. La migration se fait lors de la première consultation, sans commande spéciale. Les statistiques historiques comptaient des **mains**, pas des parties terminées : elles restent accessibles dans l’ancien écran Statistiques. Les nouveaux compteurs compétitifs et les XP commencent avec cette version, sans inventer d’historique.

Les sauvegardes utilisent un fichier temporaire puis un renommage. Le serveur reste une application à processus unique avec des données JSON et des parties en mémoire. Un redémarrage interrompt les parties en cours ; les récompenses déjà sauvegardées, les tickets de finale et les choix de roue restent persistants.

L’identification par pseudo existante est conservée. Les mutations utilisent l’identité du socket et ignorent les noms fournis pour désigner un autre bénéficiaire, mais **le pseudo ne constitue pas une authentification de compte**. Cette mise à jour n’ajoute ni mot de passe ni preuve de propriété du pseudo.

## Vérification locale

```powershell
cd "C:\Users\Valentin\poker-server"
node --test tests/progression.test.cjs tests/progression-sockets.test.cjs tests/competitive-settlement.test.cjs tests/competitive-settlement-edge.test.cjs tests/progression-server.test.cjs
node scripts/verify-imdcx-visuals.cjs
```

Les tests du serveur lancent une copie isolée avec des données temporaires. Le contrôle navigateur utilise le véritable HTML et le moteur de progression avec des données en mémoire ; il ne lance pas de partie sur les données locales. Les captures sont dans `build/imdcx-review/`, ignoré par Git. Node 22 et Chrome sont utilisés pour ces contrôles. Aucune nouvelle dépendance npm n’est nécessaire pour l’application.

## Transfert depuis PowerShell

Avant le transfert, sauvegarder les JSON sur le serveur et prévoir le redémarrage en dehors d’une partie. **Ne pas transférer les JSON locaux** : cela remplacerait les données des joueurs en ligne. Les fichiers `docs/`, `tests/` et `scripts/verify-imdcx-visuals.cjs` servent au développement, ils ne sont pas nécessaires au site.

```powershell
cd "C:\Users\Valentin\poker-server"

ssh root@srv1120905.hstgr.cloud 'mkdir -p /var/www/poker-server/lib'
scp "lib/progression.js" "lib/competitive-settlement.js" "lib/progression-sockets.js" root@srv1120905.hstgr.cloud:/var/www/poker-server/lib/
scp "poker-app/static/css/progression.css" root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/
scp "poker-app/static/js/progression-ui.js" "poker-app/static/js/client.js" root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/
scp "server.js" root@srv1120905.hstgr.cloud:/var/www/poker-server/
scp "poker-app/poker.html" root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/
```

Redémarrer ensuite **le processus Node de cette application** avec le gestionnaire déjà utilisé sur le serveur, puis actualiser le navigateur avec `Ctrl + F5`. Le nom de ce processus n’est pas défini dans le dépôt ; ne pas utiliser une commande qui redémarre tous les services. Le transfert seul ne recharge pas le code du serveur.

Ces commandes supposent la précédente mise à jour visuelle déjà transférée : `imdcx-premium.css`, `imdcx-visuals.js`, `home-bg-desktop.png`, `hero-card-fan.png` et les autres ressources existantes restent utilisées.
