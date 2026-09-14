# Démo manuelle du poker existant

Démarrer le serveur local avec `npm start` (le redémarrer s’il était déjà lancé),
puis ouvrir `http://localhost:3000/poker.html` et cliquer sur **DÉMO**, à côté des
entrées Bataille et roue.

- **FACE-À-FACE — 2 JOUEURS** : contrôler P1 et P2.
- **TABLE — 10 JOUEURS** : contrôler P1 à P10.

Les commandes de poker existantes agissent pour le joueur indiqué par
« À vous de jouer : P… ». Le contrôleur suit l’ordre des tours du moteur, y
compris les choix SHOW/HIDE. Aucun bot et aucune décision automatique à
l’expiration d’un délai. Les distributions, blinds, mises, pots, animations,
showdowns et évaluations sont ceux du jeu existant.

**Voir toutes les cartes** affiche les deux cartes de chaque siège dans la barre
de démo. Ce panneau n’existe pas dans les parties normales.

- **Nouvelle main** : distribue la main suivante avec le moteur existant. Si la
  main est encore en cours, ses mises sont remboursées ; si elle est terminée,
  ses gains sont conservés.
- **Recommencer la partie** : réinitialise tous les sièges à 20 000 jetons.
- **Quitter la démo** : supprime la session et revient à l’accueil.

La démo utilise le mode de mises `normal` existant (blinds initiales 50/100).
Elle est temporaire : recharger la page ou perdre puis rétablir la connexion
lance une nouvelle partie de démo. Le serveur local doit rester accessible.
Liens directs : `/poker.html?demo=2` et `/poker.html?demo=10`.

## Isolation et implémentation

`lib/demo-controller.js` crée une salle privée en mémoire et attribue tous les
sièges à une seule connexion. Il appelle `tryStartGame`, `tryStartMatch2` et
`dealNextHand`. Les décisions passent dans le handler `playerAction` existant,
avec vérification de la salle, de la main, du siège et de la révision.

Les salles de démo sont exclues des listes et fichiers de configuration. Les
joueurs de démo ne sont pas des comptes : les écritures d’historique, de
statistiques, de crédits et de promotion sont désactivées, et la progression
compétitive est inéligible. Les autres actions de compte sont bloquées sur la
connexion de démo, y compris récompenses, missions, XP et multiplicateurs.

`imdcx-demo.js` sélectionne le siège contrôlé et appelle le rendu et les commandes
existants. Les cartes, tables, règles et animations n’ont pas été remplacées.

## Vérification

Les tests utilisent exclusivement des serveurs temporaires avec des données
fictives, sans lire ni copier les bases de joueurs du projet.

```powershell
node --test tests/progression-server.test.cjs
node --test tests/progression.test.cjs tests/progression-sockets.test.cjs tests/competitive-settlement.test.cjs tests/competitive-settlement-edge.test.cjs
node scripts/verify-manual-demo.cjs
```

Le dernier script nécessite Chrome et vérifie la vraie page avec le vrai serveur
sur des formats ordinateur et mobile. Captures et résultats : `build/demo-review/`.
