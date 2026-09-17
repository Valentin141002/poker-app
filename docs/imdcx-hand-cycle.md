# Cycle de fin de main IMDCX

## Ce qui a été constaté

Le signalement utilisateur décrit une victoire et un pot attribué, puis aucune
nouvelle distribution. La reproduction serveur seule n’a pas reproduit ce gel
avec le code présent au début de l’intervention (`HEAD a07eab8c`). Sur un vrai
serveur isolé, des clients WebSocket ont joué toutes les streets en check/call,
puis choisi SHOW pour chaque siège, sans cliquer sur **Nouvelle main** :

| Démo | État de départ | État reçu ensuite | Délai mesuré |
| --- | --- | --- | --- |
| 2 joueurs | Main 1, `reveal`, pot attribué | Main 2, `preflop` | 10 341 ms |
| 10 joueurs | Main 1, `reveal`, pot attribué | Main 2, `preflop` | 10 269 ms |

Il serait donc incorrect d’attribuer le gel signalé à une absence totale de
continuation automatique dans cette version. Chrome confirme aussi la
continuation sur le code initial : les démos 2 et 10 atteignent chacune la
main 3, avec transition, reset des cartes et reprise des mises. **29 contrôles
réussis, aucune exception**. Le rapport est dans
`build/baseline-hand-cycle-review/checks.json`. Cette comparaison charge
`server.js`, `demo-controller.js` et `imdcx-demo.js` du commit initial et conserve
les autres fichiers actuels. Aucune cause unique du gel signalé sans pause
n’est donc affirmée ici.

Un blocage précis a en revanche été reproduit dans le code initial en plaçant
une pause pendant la distribution différée du tableau. `pauseGame` mettait les
joueurs en `WAIT` sans arrêter les callbacks de `startReveal`. Ces callbacks
initialisaient alors un reveal sans joueur. À la reprise, `resumeGame` ne
trouvait ni siège de révélation actif ni révélation terminée et ne programmait
aucune continuation. L’état observé, même 30 secondes après reprise, était :

```json
{"phase":"reveal","paused":false,"revealSeq":{"order":[],"activeSeat":null,"done":false},"evaluated":false,"timers":0,"handsStarted":0}
```

Le client restait donc sur le dernier état reçu : aucun nouveau `preflop` ne
pouvait déclencher son reset et sa transition. Ce cas ne prouve pas que le gel
initial sans pause avait la même cause.

Deux mécanismes de continuation existaient cependant. Les parties réelles
utilisaient les timers de fin de révélation dans `server.js`. Les démos en
étaient exclues et utilisaient un intervalle de 350 ms dans
`lib/demo-controller.js`, puis leur propre délai de 10 secondes. Ce second
chemin copiait l’état dans une nouvelle salle avant d’appeler `dealNextHand`.
Le correctif supprime cette orchestration parallèle et protège la continuation
contre les callbacks et commandes devenus obsolètes.

## Flux serveur

Le déroulement utilise les fonctions du moteur existant :

1. `startReveal` ou `startRevealAllIn` termine, si nécessaire, la distribution
   du tableau puis initialise la séquence de révélation.
2. `applyRevealChoice` et `advanceRevealSequence` traitent les choix SHOW/HIDE.
   `finalizeRevealWinners` et les évaluateurs existants attribuent les gains.
3. Une fois `phase === 'reveal'`, `roundEvaluated` et `revealSeqDone` réunis,
   `scheduleNextHand` arme un seul délai de 10 secondes dans
   `revealFinishTimersByRoom`. Les branches de fin par SHOW et par HIDE utilisent
   toutes ce même point de continuation, en démo et en partie réelle.
4. Le callback vérifie encore l’identité du timer, l’objet d’état, le numéro de
   main et les indicateurs de fin avant d’appeler `dealNextHand`.
5. `dealNextHand` annule les anciens timers de tour, de révélation et de
   distribution différée, incrémente `roundNumber`, remet à zéro les mises et
   les données temporaires, puis utilise `distributeCards` et `configureBlinds`.
   Le moteur existant effectue la rotation du dealer et des blinds, distribue
   les cartes et diffuse le nouvel état. Les tours de mises reprennent ensuite
   selon le mode habituel.

Une partie marquée `gameFinished` ne programme aucune autre main. Cette fin de
partie reste distincte d’une fin de main ; le correctif ne réinitialise pas les
stacks et ne modifie ni l’évaluation des cartes ni l’attribution des pots.

La démo reste manuelle pour les mises. Le choix SHOW/HIDE laissé sans réponse
avait déjà un fallback de 5 secondes dans le moteur ; ce comportement est
conservé. Les révélations obligatoires des showdowns all-in restent également
celles du moteur existant.

## Flux client

`imdcx-demo.js` reçoit `startGame`, `updateTable` et `updateMatch2`, élimine les
paquets strictement identiques, sélectionne le siège contrôlé et transmet l’état
à `handleGameStateUpdate` dans `client.js`.

La continuation automatique conserve désormais la salle. Le contrôleur démo
reconnaît donc une nouvelle main par le changement de `roundNumber`, en plus du
changement éventuel de `demoRoomID`. Il invalide les anciennes animations de
cartes, vide les cartes révélées et leurs classes temporaires, réinitialise les
données de révélation et efface le message du gagnant. Il conserve l’état
précédent jusqu’à l’appel au rendu commun pour que celui-ci voie bien le passage
de `reveal` à `preflop`.

Le rendu commun garde sa transition existante : `IMDCXMotion.prepare`, puis
`maybeTriggerHandTornado` / `IMDCXMotion.newHand`, réinitialisation des dos de
cartes et du pot visuel, puis rendu du nouvel état et des commandes de mises.
Dans le module de mouvement actuel, les callbacks de réinitialisation sont
appelés immédiatement : la progression du serveur ne dépend pas de la fin d’une
animation CSS. Aucun visuel, durée d’animation ou règle de poker n’est remplacé.

## Double déclenchement et timers

- Le timer de prochaine main appartient à un objet d’état et à un numéro de
  main précis. Le rappeler ou recevoir un vieux callback ne doit ni créer un
  deuxième timer ni faire avancer la main suivante.
- Les timers de décision SHOW/HIDE vérifient aussi la séquence et le siège
  concernés. Leur référence est supprimée lorsqu’ils s’exécutent. Une reprise
  avec zéro milliseconde restante conserve ce délai nul.
- Les distributions différées sont enregistrées par salle et annulées lors
  d’un changement de main ou de la suppression d’une démo. Leurs callbacks
  vérifient l’état, la main et leur enregistrement actif. La pause conserve leurs
  délais restants dans une structure privée ; la reprise restaure les joueurs
  avant de reprogrammer ces callbacks une seule fois. Aucune closure n’est
  ajoutée à l’état transmis aux clients.
- Les timers de tour des tables et des duels sont nettoyés à l’entrée en
  révélation et lors de la nouvelle distribution.
- Les boutons **Nouvelle main** et **Recommencer la partie** transmettent
  `demoRoomID` et `demoRound`. Le serveur refuse un jeton absent ou périmé avec
  `STALE_HAND` ; le client bloque aussi une deuxième commande pendant l’attente
  de la première réponse. Une avance automatique concurrente invalide le clic
  portant sur l’ancienne main.
- Le bouton **Nouvelle main** conserve son comportement : les mises d’une main
  inachevée sont remboursées ; les gains d’une main terminée sont conservés.
  Les commandes manuelles remplacent encore la salle pour retirer les anciens
  travaux différés. La continuation automatique utilise directement le moteur
  dans la salle courante.

## Validation exécutée

Les tests d’intégration ci-dessous ont réussi sur des serveurs temporaires avec
des bases fictives, sans copier ni modifier les bases utilisateur :

| Commande | Résultat | Couverture |
| --- | --- | --- |
| `node --test tests/hand-cycle-server.test.cjs` | 3 tests réussis, environ 34 s | Démo 2/10, deux transitions automatiques successives, SHOW et HIDE, rotation dealer, conservation des jetons, reset des indicateurs, avance manuelle pendant le délai gagnant, refus des commandes périmées, attente de 10,5 s sans avance parasite, reprise des mises et sortie de démo |
| `node --test tests/progression-server.test.cjs` | 7 tests réussis, environ 52 s | Démo 2/10, toutes les streets, all-in, reset pendant distribution différée, attente de 31 s sans ancien callback, isolation des comptes et statistiques, progression existante |
| `node --test tests/hand-cycle-timers.test.cjs` | 23 tests réussis | Chemins réel/démo 2/10, SHOW/HIDE/all-in, callback périmé, un seul délai de prochaine main, pause/reprise du délai gagnant et de la distribution différée, arrêt du timer de tour en duel, fin de partie |

La suite complète (`node --test tests/*.test.cjs`) totalise **89 tests réussis**.
Les tests de timers exécutent les fonctions réelles de `server.js` avec une
horloge contrôlée. Le test de pause pendant distribution échoue sur le code
initial et réussit après correction. Les chemins de fin de main réels sont
couverts ainsi ; aucune partie de production n’a été lancée pour cette enquête.

La vérification navigateur se lance avec :

```powershell
node scripts/verify-manual-demo.cjs --hand-cycle
```

Elle a réussi **61 contrôles**, avec **8 transitions automatiques** : deux mains
successives pour chaque combinaison démo 2/10 et animations normales/réduites.
Elle vérifie la transition unique, la rotation du dealer, le nettoyage des
cartes et du timer de révélation, les nouvelles cartes privées, la reprise des
mises et le double clic. **Aucune exception navigateur**. Les captures et le
rapport sont dans `build/hand-cycle-review/`.

Chrome a dû être exécuté hors du sandbox avec un profil temporaire : dans le
sandbox, son processus graphique échouait avant même le chargement du jeu.
Cela ne constituait pas une erreur de la page de poker.
