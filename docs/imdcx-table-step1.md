# Table IMDCX — étape 1

Cette étape améliore uniquement la présentation de la table existante : panneaux
des sièges, contraste des noms et tapis, couleurs des deux thèmes, pot, statut,
boutons utilitaires et adaptation aux petits écrans.

Les images de cartes et de tables existantes sont réutilisées. En démo, pendant
les mises, seule la main du joueur contrôlé apparaît dans la zone habituelle :
aucun dos parasite sur les autres sièges. Pendant la révélation, SHOW affiche
les deux faces confirmées par le serveur, côte à côte dans le panneau du siège.
HIDE les masque. Les cartes montrées restent visibles lors du changement de
joueur contrôlé et jusqu'à la nouvelle main.

Le retournement existant est réutilisé, avec une protection contre les rappels
d'animation d'une ancienne main. Les règles, le moteur et les décisions ne sont
pas réécrits. Le calculateur reste hors périmètre.

## Fichiers

- `poker-app/static/css/imdcx-table.css` : présentation commune et variantes néon/fruity.
- `poker-app/static/js/imdcx-table.js` : placement visuel des cartes dans les sièges.
- `poker-app/static/js/imdcx-demo.js` : affichage SHOW/HIDE indépendant du siège contrôlé.
- `poker-app/static/css/imdcx-demo.css` : visibilité des cartes et placement des informations en révélation.
- `poker-app/static/js/gui_if.js` : retournement protégé, activé par le contrôleur de démo.
- `server.js` : après SHOW/HIDE, la démo attend « Nouvelle main » ; les timers des parties normales sont conservés.
- `poker-app/poker.html` : chargement de ces deux modules.
- `poker-app/static/js/client.js` : branchement du placement, marge mobile et
  ajustement vertical en paysage ; repli vers l'image T1 existante lorsque le
  niveau ne possède pas d'image, car `poker_table.png` est absent du dossier actuel.

Les modifications de démo déjà présentes dans ces fichiers sont conservées.
Pour mettre cette correction en ligne, transférer les huit fichiers ci-dessus
ensemble, redémarrer le processus Node du jeu, puis recharger la page avec le
cache vidé. Le redémarrage applique l'attente manuelle après la révélation.

## Vérification

```powershell
node scripts/verify-manual-demo.cjs --table-polish
node scripts/verify-manual-demo.cjs --reveal-cards
node scripts/verify-manual-demo.cjs
node --test tests/progression-server.test.cjs
```

Le script lance Chrome et un serveur temporaire avec des données fictives.
Il vérifie les deux thèmes en 1920×1080, 390×844, 320×740 et 844×390 :
zones de cartes et commandes dans l'écran, image de table chargée, passage au
flop avec les commandes existantes et styles du calculateur identiques avec
et sans la nouvelle feuille CSS. Captures et rapport : `build/table-step1-review/`.

Le scénario `--reveal-cards` contrôle SHOW/HIDE sur les démos à 2 et 10 joueurs,
les faces exactes, leur visibilité et leur placement, les changements de thème
et le nettoyage à la nouvelle main. Captures : `build/demo-reveal-review/`.

Limite existante observée sur grand écran : l'ouverture du calculateur appelle
`makeDraggable`, qui n'est pas défini. Le script confirme le même problème sans
la nouvelle feuille CSS et le rapporte dans `existingLimitations`. Il n'est pas
corrigé ici, conformément au périmètre demandé.

La vérification utilise une émulation mobile ; un contrôle sur téléphone réel
reste utile pour apprécier le confort tactile.

## Ajouter les modifications à Git

```powershell
git add -- server.js poker-app/poker.html poker-app/static/js/client.js poker-app/static/js/gui_if.js poker-app/static/js/imdcx-demo.js poker-app/static/js/imdcx-table.js poker-app/static/css/imdcx-demo.css poker-app/static/css/imdcx-table.css scripts/verify-manual-demo.cjs docs/imdcx-table-step1.md
git commit -m "Corrige SHOW en demo et ameliore la presentation de la table"
```

Le commit inclut aussi les autres fichiers déjà préparés dans l'index Git.

## Mettre à jour le serveur

Depuis PowerShell, à la racine du projet, lorsque la démo est déjà installée :

```powershell
scp "poker-app/static/css/imdcx-demo.css" "poker-app/static/css/imdcx-table.css" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/"
scp "poker-app/static/js/client.js" "poker-app/static/js/gui_if.js" "poker-app/static/js/imdcx-demo.js" "poker-app/static/js/imdcx-table.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/"
scp "poker-app/poker.html" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/"
scp "server.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/"
```

Redémarrer ensuite le processus Node habituel du jeu sur le serveur, puis
recharger avec Ctrl + F5. La page référence les nouveaux fichiers avec
une version de cache mise à jour. Aucun transfert des bases de joueurs.
