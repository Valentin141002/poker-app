# IMDCX — rendu néon des références

Cette mise à jour conserve la table, ses dix emplacements, les commandes et le
moteur de poker existants. Les modifications concernent le rendu des cartes,
les effets et leur synchronisation avec les états reçus du serveur.
Les montants, décisions SHOW/HIDE et gagnants restent fournis par le jeu.

## Composants identifiés avant modification

| Fonction | Fichiers et points d'entrée |
| --- | --- |
| Sièges et état actif | `client.js` : `updateInterface`, `handleGameStateUpdate` |
| Faces et retournements | `gui_if.js` : `internal_setCard`, `internal_GetCardImageUrl`, `flipCardsSimultaneously` |
| SHOW/HIDE de la démo | `imdcx-demo.js` : `renderRevealCards` |
| Cartes communes du haut | `client.js` : `setupBoardBacks`, `setBoardFace`, `boardRenderEpoch` |
| Placement des cartes montrées | `imdcx-table.js` : `layoutSeatCards` |
| Distribution, mises et victoire | `imdcx-motion.js` : `newHand`, `deal`, `state`, `award`, `scoop` |
| Lumières et matériaux | `imdcx-neon.css`, `imdcx-motion.css` |

## Résultat

- Le néon est le thème initial. Le choix explicite du thème fruity reste disponible.
- La table verte existante et les dos JAQKT néon sont réutilisés. Les faces
  vectorielles affichent un rang lisible et une grande couleur rouge ou noire,
  comme les références, sans modifier les cartes réellement distribuées.
- Nouvelle main : vortex cyan/violet de 800 ms, anneaux inclinés et dos en orbite.
- Distribution : départ après 420 ms, trajets de 440 ms, décalage entre sièges,
  traînées lumineuses et impulsions sur les panneaux d'arrivée. Les dos en vol
  disparaissent ; aucun dos adverse ne reste sur un siège pendant les mises.
- Joueur actif : cadre cyan lumineux, accent rose/violet et orbite discrète.
- Mises : montant temporaire et jetons dirigés du siège vers le pot.
- Les cinq cartes communes restent dans le rail supérieur : trois retournements,
  puis le quatrième, puis le cinquième. Aucun titre Flop/Turn/River n'est affiché.
- SHOW : retournement de 370 ms, décalage de 55 ms entre les deux cartes,
  puis deux faces superposées dans le panneau du siège, en démo et en partie normale.
  HIDE efface les faces, y compris après un changement de thème.
- Victoire : cadre et couronne dorés, annonce de 1,5 s et jetons vers le gagnant.
  L'annonce indique YOU WIN pour le joueur concerné, le siège gagnant sinon,
  et SPLIT POT en cas de partage. Le module ne calcule aucun partage de pot.

Les effets ne captent pas les clics. Les nouveaux états ne sont jamais retardés
par une animation. Une nouvelle main invalide les anciens retournements ; un
redimensionnement ou le mouvement réduit termine les peintures encore valides.
La couche temporaire est limitée à 48 éléments directs.

## Fichiers nécessaires

La page `poker-app/poker.html` charge les fichiers suivants, à distribuer ensemble :

- `static/css/imdcx-neon.css` — nouveau fichier ;
- `static/css/imdcx-motion.css` ;
- `static/js/imdcx-motion.js` ;
- `static/js/imdcx-table.js` ;
- `static/js/client.js` ;
- `static/js/gui_if.js` ;
- `static/js/imdcx-demo.js`.

Les images existantes `poker_table_vert.png` et `cardback2.png` restent nécessaires.
Les URLs de la page sont versionnées pour éviter un mélange de fichiers en cache.
Aucune migration de données ni modification du serveur n'est nécessaire.

## Vérification locale

```powershell
node scripts/verify-manual-demo.cjs --neon-reference
node scripts/verify-manual-demo.cjs --motion
node scripts/verify-manual-demo.cjs --live-reveal
```

Les scripts utilisent Chrome et un serveur temporaire avec des données fictives
isolées. `--viewport=390` permet un contrôle néon limité au format 390 × 844.

- Néon : 88 contrôles réussis sur les démos à 2 et 10 sièges en 1440 × 900,
  390 × 844 et 320 × 740 ; aucun problème JavaScript détecté.
- Mouvement : 113 contrôles réussis, incluant les deux thèmes, les six actions,
  844 × 390, les interruptions et le mouvement réduit.
- Hors démo : 11 contrôles réussis et aucune exception navigateur. Ce contrôle
  rejoue des instantanés réels dans le navigateur isolé pour vérifier SHOW/HIDE
  côté joueur et spectateur ; ce n'est pas un test
  de connexion multijoueur en production.

Captures et rapports : `build/neon-reference-review/`, `build/motion-review/`,
`build/live-reveal-review/`. Les performances sur téléphone physique et une
session multijoueur en production restent à vérifier.
