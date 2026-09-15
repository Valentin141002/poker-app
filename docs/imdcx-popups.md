# IMDCX — fenêtres de jeu

Cette phase concerne uniquement les fenêtres : mise/relance, règles, probabilités,
SOS, statistiques, TIME, +30s et explications SHOW/HIDE. La table, les cartes,
le moteur, les règles et la démo existante sont conservés.

## Composants identifiés avant modification

| Responsabilité | Fichiers / composants existants |
| --- | --- |
| Panneau Raise / Bet | `poker-app/static/js/client.js`, fonction `show_custom_raise`, éléments `.raise-window`, `#calc-display`, `#calc-slider` |
| Calculs et validation | Fonctions `calcConfirm`, `calcAllIn`, `calcClear`, `calcAddAmount`, `calcAddDigit` et presets de pot dans `client.js` ; calculs inchangés |
| Rendu des fenêtres | `poker-app/poker.html` : `rules-modal`, `odds-modal`, `sos-modal`, `stats-modal` et fenêtres secondaires ; ouverture et contenu dynamique dans `client.js` |
| Styles et boutons existants | `poker-app/static/css/poker.css`, `phone.css`, avec plusieurs surcharges historiques du calculateur |
| Thème actif | `applyTierBackgroundTheme` dans `client.js` et classe `body.tier-fruity-bg` |

## Présentation commune

- `poker-app/static/css/imdcx-popups.css` fournit une structure responsive commune
  et deux palettes. Néon : bleu nuit, accents cyan et violet, panneaux fumés.
  Fruity : ivoire, rose, prune, boutons dorés et jetons colorés avec accents fruités.
- `poker-app/static/js/imdcx-popups.js` gère uniquement la présentation du
  calculateur, l'ordre des fenêtres superposées et la navigation au clavier.
- `poker-app/poker.html` charge ces deux fichiers avec une version de cache.
- `client.js` conserve les événements, valeurs et validations existants. Son
  ancien redimensionnement global du calculateur est remplacé par une grille
  responsive : les textes et les commandes ne sont plus miniaturisés ensemble.

Les fenêtres sont déplacées sous `body` par le code existant ; les styles ciblent
donc les fenêtres elles-mêmes. Changer le thème applique immédiatement la nouvelle
palette sans recréer le formulaire ni effacer le montant saisi.

Le panneau garde STACK, MONTANT, les cinq valeurs de jetons, ALL-IN, CLEAR, BET,
le curseur et ses repères 25/50/75/100 %, les commandes 30, %, opacité et déplacement.
Les chiffres, presets de pot et statistiques PRO gardent leurs conditions d'accès.
La fermeture possède désormais un bouton dédié. Les contenus longs défilent ;
l'en-tête du calculateur et les fermetures restent accessibles. Échap ferme
uniquement la fenêtre au premier plan et le focus revient à son bouton d'ouverture.

L'appel historique à `makeDraggable`, absent du projet, est remplacé par un
branchement sur le déplacement existant `nudgeCalcWindow`. Aucun calcul de mise
n'est modifié. Quelques symboles mal encodés du calculateur et de l'historique
des statistiques sont corrigés.

## Vérifier

Depuis la racine du projet, avec Node et Chrome installés :

```powershell
node scripts/verify-manual-demo.cjs --popups
node scripts/verify-manual-demo.cjs
```

Le premier scénario utilise `scripts/verify-popups.cjs` dans le navigateur et le
serveur temporaires du script existant. Il contrôle les deux thèmes en
1440×900, 390×844, 320×740 et 844×390 : limites de l'écran, absence de débordement
horizontal, dimensions des commandes, défilement, clavier, fenêtres imbriquées,
opacité, changement de thème pendant la saisie, commandes Standard et PRO,
déplacement et redimensionnement. Il soumet aussi une mise avec le moteur réel.
Les actions sont effectuées sur des données fictives isolées ; aucune alerte
ni aucun message SOS n'est envoyé.

Le second scénario vérifie la démo à 2 et 10 places, les changements de joueur,
les all-ins jusqu'au showdown, la nouvelle main, le redémarrage et la sortie.

Captures et rapports : `build/popup-review/` et `build/demo-review/` (non versionnés).
Les tests mobiles utilisent l'émulation Chrome ; le rendu sur téléphone physique
n'a pas été vérifié ici.

## Ajouter les fichiers à Git

Cette commande inclut explicitement les nouveaux fichiers non suivis :

```powershell
git add -- poker-app/poker.html poker-app/static/js/client.js poker-app/static/js/imdcx-popups.js poker-app/static/css/imdcx-popups.css scripts/verify-manual-demo.cjs scripts/verify-popups.cjs docs/imdcx-popups.md
git diff --cached --stat
git commit -m "Ameliore les popups IMDCX et leur adaptation aux themes"
```

`Added` signifie que le nouveau fichier est préparé pour le commit. Le commit
inclut également les autres modifications déjà présentes dans l'index Git.

## Transférer cette phase sur le serveur

Lorsque les phases précédentes sont déjà installées, depuis PowerShell à la
racine du projet, transférer les scripts et styles avant la page qui les charge :

```powershell
scp "poker-app/static/css/imdcx-popups.css" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/"
scp "poker-app/static/js/client.js" "poker-app/static/js/imdcx-popups.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/"
scp "poker-app/poker.html" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/"
```

Recharger ensuite la page avec Ctrl + F5. Cette phase modifie uniquement le client
et ne nécessite pas de redémarrage du serveur Node.
