# IMDCX — Phase 3 : animations et retours visuels

> Mise à jour du 16 septembre : le rendu des références néon, les fichiers à
> charger ensemble et les contrôles actuels sont décrits dans
> [imdcx-neon-reference.md](imdcx-neon-reference.md). Les durées ci-dessous
> décrivent la version précédente.

Cette phase améliore uniquement les animations du jeu existant. La structure
de la table et des popups, les cartes, les règles, le moteur et les décisions
de mise sont conservés. La démo manuelle à 2 et 10 sièges reste disponible.

## Composants repérés avant modification

| Rôle | Composants existants |
| --- | --- |
| Réception des états | `client.js` : `handleGameStateUpdate`, `updateInterface` |
| Nouvelle main | `maybeTriggerHandTornado`, `resetAllBacks`, `setupBoardBacks` |
| Distribution et main personnelle | `animateMyCards`, `flipMyCardsWithLift3D` |
| Faces des cartes / SHOW | `gui_if.js` : `internal_setCard`, `flipCardsSimultaneously` ; `imdcx-demo.js` : `renderRevealCards` |
| Flop, turn et river | `setBoardFace`, `boardRenderEpoch`, `resetBoardRenderState` |
| Actions et jetons | Détecteurs `maybeTriggerBetBeam`, `maybeTriggerFoldDrop`, `maybeTriggerCheckPass`, `maybeTriggerCallPulse`, `maybeTriggerBetPulse` |
| Tour actif | Classes `.seat.turn` et `.demo-reveal-active` |
| Pot et victoire | `gui_write_basic_general`, `triggerRevealWinnerFireworks`, `triggerPotScoopToSeat` |
| Styles et thèmes | `poker.css`, `imdcx-table.css`, classe `body.tier-fruity-bg` |

## Modifications

Le module `poker-app/static/js/imdcx-motion.js` reçoit les états déjà confirmés
par le jeu. Il observe les changements de joueur, statut et contribution pour
afficher les retours CHECK, CALL, BET, RAISE, ALL-IN et FOLD. Il ne décide pas
d'une action, ne recalcule pas un gagnant et n'émet aucun message au serveur.

La feuille `poker-app/static/css/imdcx-motion.css` ajoute les effets temporaires
et les accents des deux thèmes. Néon utilise cyan, bleu et violet ; fruity
utilise rose, or et de petites particules en forme de feuilles. Les durées et
les trajectoires sont communes aux deux thèmes.

- Nouvelle main : vortex de 620 ms, avec un nombre limité de particules.
  Les nouveaux états s'affichent immédiatement, sans attendre la fin du vortex.
- Distribution : mouvements de 360–420 ms, léger relief et arrivée amortie.
  Les dos en transit vers les autres sièges disparaissent à l'arrivée.
- Joueur actif : petite élévation temporaire du panneau et deux pulsations
  légères, suivies de son état actif habituel.
- Actions : indication courte de 650 ms et réaction du siège adaptée à l'action.
  Le long effet VS des all-ins est remplacé par ces retours individuels.
- Mises : 2 à 5 jetons suivent un arc vers le pot en 440 ms, avec un léger
  décalage entre les jetons. La valeur du pot reçoit une animation de 300 ms ;
  son nombre reste celui fourni par le rendu existant.
- Cartes du tableau et SHOW : retournement en 370 ms, face remplacée au
  milieu du mouvement, petits décalages entre cartes.
- Victoire : surlignage du siège et de ses cartes déjà révélées, bref éclat
  et trajet de jetons vers le gagnant en 560 ms. Les gagnants multiples
  reçoivent chacun un effet ; ces jetons sont décoratifs, sans calcul de paiement.

Les cartes gagnantes publiquement montrées restent visibles pendant l'annonce.
La sélection exacte des cinq cartes de la combinaison n'est pas recalculée :
le surlignage porte sur les cartes personnelles révélées du gagnant.

Les délais existants avant l'ouverture de la main personnelle et avant l'annonce
du résultat sont conservés. Les timers de jeu, les tours de parole, les montants
et l'attribution réelle des pots restent gérés par le code existant.

## Interruptions et performances

Les effets utilisent essentiellement les transformations et l'opacité via les
Web Animations. La couche décorative ne capte aucun clic et reste sous les popups.
Elle est limitée à 48 éléments temporaires, y compris sur une table à 10 sièges.
Les effets terminés sont retirés ; les animations de cartes sont annulées à la
nouvelle main et protégées par une génération de rendu.

Un redimensionnement, le passage de l'onglet en arrière-plan ou l'activation
de `prefers-reduced-motion` termine les peintures encore valides et arrête les
effets décoratifs. Un ancien retournement ne doit pas repeindre une nouvelle main.

La cible est une animation fluide à 60 images/s. Les essais Chrome ne constituent
pas une garantie de cette cadence sur chaque téléphone physique.

## Vérification locale

```powershell
node scripts/verify-manual-demo.cjs --motion
node scripts/verify-manual-demo.cjs --reveal-cards
```

Les scénarios utilisent Chrome et un serveur temporaire avec des données
fictives isolées. Ils couvrent les deux thèmes en 1440×900, 390×844, 320×740 et
844×390, les six actions, les faces réellement distribuées, les interruptions,
les cartes gagnantes, les effets terminés et le mouvement réduit.

Le scénario SHOW/HIDE couvre les démos à 2 et 10 sièges, le changement de thème,
la position des faces, les annonces différées et une nouvelle main pendant SHOW.
Captures et rapports : `build/motion-review/` et `build/demo-reveal-review/`.
Un contrôle sur téléphone physique reste à effectuer.

## Ajouter les fichiers, y compris les nouveaux fichiers non suivis

Depuis la racine du projet :

```powershell
git add -- poker-app/poker.html poker-app/static/js/client.js poker-app/static/js/gui_if.js poker-app/static/js/imdcx-motion.js poker-app/static/css/imdcx-motion.css scripts/verify-manual-demo.cjs scripts/verify-motion.cjs docs/imdcx-phase3-animations.md
git diff --cached --stat
git commit -m "Ameliore les animations et les retours visuels du poker"
```

`Added` signifie que le fichier est prêt pour le commit. Celui-ci inclut aussi
les autres fichiers déjà présents dans l'index Git.

## Mettre à jour le serveur

Lorsque les phases précédentes sont déjà installées, depuis PowerShell à la
racine du projet, transférer les ressources puis la page :

```powershell
scp "poker-app/static/css/imdcx-motion.css" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/"
scp "poker-app/static/js/client.js" "poker-app/static/js/gui_if.js" "poker-app/static/js/imdcx-motion.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/"
scp "poker-app/poker.html" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/"
```

Recharger ensuite avec Ctrl + F5. Ces modifications sont côté client ; cette
phase ne nécessite pas de redémarrage du serveur Node.
