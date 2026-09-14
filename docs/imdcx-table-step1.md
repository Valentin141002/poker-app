# Table IMDCX — étape 1

Cette étape améliore uniquement la présentation de la table existante : panneaux
des sièges, contraste des noms et tapis, couleurs des deux thèmes, pot, statut,
boutons utilitaires et adaptation aux petits écrans.

Les images de cartes et de tables existantes sont réutilisées. Pendant les mises,
les cartes des autres sièges occupent un emplacement compact dans leur panneau,
pour laisser les informations lisibles. Le rendu de révélation existant reste
pris en charge par le client. Les règles, le moteur, les décisions et les
animations de jeu ne sont pas réécrits. Le calculateur est hors périmètre.

## Fichiers

- `poker-app/static/css/imdcx-table.css` : présentation commune et variantes néon/fruity.
- `poker-app/static/js/imdcx-table.js` : placement visuel des cartes dans les sièges.
- `poker-app/poker.html` : chargement de ces deux modules.
- `poker-app/static/js/client.js` : branchement du placement, marge mobile et
  ajustement vertical en paysage ; repli vers l'image T1 existante lorsque le
  niveau ne possède pas d'image, car `poker_table.png` est absent du dossier actuel.

Les modifications de démo déjà présentes dans ces fichiers sont conservées.
Pour mettre cette étape en ligne, transférer les quatre fichiers ci-dessus
ensemble, puis recharger la page avec le cache vidé. Aucun changement serveur
n'est nécessaire pour cette étape visuelle.

## Vérification

```powershell
node scripts/verify-manual-demo.cjs --table-polish
```

Le script lance Chrome et un serveur temporaire avec des données fictives.
Il vérifie les deux thèmes en 1920×1080, 390×844, 320×740 et 844×390 :
zones de cartes et commandes dans l'écran, image de table chargée, passage au
flop avec les commandes existantes et styles du calculateur identiques avec
et sans la nouvelle feuille CSS. Captures et rapport : `build/table-step1-review/`.

Limite existante observée sur grand écran : l'ouverture du calculateur appelle
`makeDraggable`, qui n'est pas défini. Le script confirme le même problème sans
la nouvelle feuille CSS et le rapporte dans `existingLimitations`. Il n'est pas
corrigé ici, conformément au périmètre demandé.

La vérification utilise une émulation mobile ; un contrôle sur téléphone réel
reste utile pour apprécier le confort tactile.
