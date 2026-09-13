# Accueil IMDCX — salon premium, 13 septembre 2026

Cette mise à jour concerne uniquement la présentation de l'accueil. Elle reprend la composition de la référence `ChatGPT Image 13 sept. 2026, 02_23_22.png` : logo central, statistiques latérales sur ordinateur, bouton Jouer dominant, salon sombre et sol réfléchissant.

## Fichiers à publier

- `poker-app/static/css/imdcx-premium.css` — matériaux, relief, disposition responsive et animations de l'accueil.
- `poker-app/static/js/imdcx-visuals.js` — décor de l'accueil, inclinaison, reflets et gestion du cycle de vie des effets.
- `poker-app/static/images/home-salon-luxury.webp` — nouveau fond pour ordinateur, 130 432 octets.
- `poker-app/static/images/home-salon-luxury-mobile.webp` — version allégée, 43 544 octets.

Les deux premiers fichiers existaient déjà. Les deux images sont nouvelles. Le HTML et le client chargent déjà la couche visuelle : aucun changement supplémentaire n'y est nécessaire pour cette mise à jour. Le serveur, les données des joueurs, les récompenses, le classement, la bataille et la roue ne sont pas modifiés.

Depuis PowerShell, pour publier uniquement cette mise à jour sur le serveur existant :

```powershell
Set-Location "C:\Users\Valentin\poker-server"

scp "poker-app/static/images/home-salon-luxury.webp" "poker-app/static/images/home-salon-luxury-mobile.webp" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/images/"
if ($LASTEXITCODE -ne 0) { throw "Échec du transfert des images." }

scp "poker-app/static/js/imdcx-visuals.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/imdcx-visuals.js"
if ($LASTEXITCODE -ne 0) { throw "Échec du transfert JavaScript." }

scp "poker-app/static/css/imdcx-premium.css" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/imdcx-premium.css"
if ($LASTEXITCODE -ne 0) { throw "Échec du transfert CSS." }
```

Recharger ensuite la page avec `Ctrl+F5`. Aucun redémarrage Node/PM2 n'est nécessaire pour ces fichiers statiques. Le dossier `docs/` et le script de vérification servent au développement ; ils n'ont pas besoin d'être transférés sur le serveur. Le transfert n'est pas effectué automatiquement par cette modification locale.

## Interactions et performance

- Les boutons présentent une face en acrylique, un biseau, une tranche et une ombre de contact. Le survol les soulève de 4 px ; l'appui les enfonce de 4 px.
- Le curseur incline les boutons et les statistiques de 3 degrés au maximum. Les reflets se déplacent sur une couche distincte.
- Le salon et les cartes/jetons décoratifs se déplacent à des profondeurs différentes, de quelques pixels. Tous ces éléments sont décoratifs, sans cible de clic ni contenu accessible redondant.
- Un seul ordonnanceur `requestAnimationFrame` gère les mouvements de l'accueil. Il s'arrête après stabilisation du pointeur. Les déplacements utilisent `transform` ; les variations de lumière utilisent `opacity`.
- Les effets se suspendent lorsque l'accueil est caché ou rendu inerte par une autre vue, lorsque l'onglet est masqué et lorsque l'utilisateur demande moins d'animations. Les pointeurs tactiles désactivent l'inclinaison et le mouvement ambiant. Les écouteurs sont libérés lorsque l'accueil est retiré du document.
- Les contrôles conservent leurs actions existantes et une indication de focus au clavier. Les statistiques et les liens de profil/défis continuent d'utiliser les données actuelles.
- Les petites largeurs réorganisent les statistiques et la navigation ; la version mobile du fond est chargée jusqu'à 600 px.

## Vérification locale

```powershell
node --check poker-app/static/js/imdcx-visuals.js
node scripts/verify-imdcx-visuals.cjs
```

La vérification utilise Chrome et la vraie page avec un serveur de données de test local. Elle ne lance pas le serveur de jeu et ne modifie pas les fichiers des joueurs. Les captures et le rapport sont enregistrés dans `build/home-luxury-review/`, ignoré par Git. Le mode `--scope-only` compare aussi les fichiers et les blocs de présentation protégés à l'instantané local pris avant ce travail, lorsque cet instantané est disponible.

Validation du 13 septembre : **102 contrôles réussis**, dont 11 comparaisons de préservation du périmètre. Les interactions, le focus clavier, les préférences d'animation, les accès existants et les formats de 320 à 1913 px ont été vérifiés. Les captures `home-reference.png`, `home-mobile.png` et `home-mobile-lower.png` ont également été inspectées visuellement.

Le navigateur de test fonctionne sans accélération GPU. Ces contrôles vérifient la disposition, les actions et l'arrêt des effets ; ils ne certifient pas un débit de 60 images par seconde sur chaque appareil. La fréquence réelle doit être mesurée sur les appareils visés.

## Origine du décor

Mode : génération d'une nouvelle image avec l'outil intégré `image_gen`, sans image jointe à l'appel. Le décor est indépendant de l'interface HTML/CSS. Le résultat original (1672 × 941) a été encodé en WebP ; la version mobile est réduite à 960 px de large. Aucun bouton, texte ou chiffre n'est intégré au fond.

Prompt exact utilisé :

```text
Use case: stylized-concept.
Asset type: a background environment only for an actual interactive premium poker HOME screen; wide 16:9 landscape, 2048x1152 if possible.
Primary request: create a luxurious dark poker salon with photorealistic architectural 3D rendering, inspired by the user's reference home screen: a tall black/navy interior with polished dark metal columns at the far sides, fine violet and electric-blue edge lighting, restrained magenta reflections, elegant sparse warm pinlights, and a polished obsidian floor with realistic soft reflections.
Composition: eye-level camera, symmetrical room with depth, floor begins around 60% of frame and occupies the lower 40%. Leave the entire middle 65% as deep navy/black quiet negative space for real HTML logo, stat cards and buttons that will be placed on top. Architectural interest and lighting at outer edges. A few short stacks of glossy black poker chips at the extreme bottom-left and extreme bottom-right, confined to outermost 12% of image. Central room recedes into a dim atmospheric lounge.
Lighting/mood: luxury competitive poker, understated, cinematic and immersive, deep blacks and navy, purposeful narrow violet accent lighting, only small blue/magenta light pools on floor. Premium materials with subtle surface texture. Clearly visible polished floor and structural columns, not empty space.
Constraints: absolutely NO text, NO lettering, NO numbers, NO logo, NO UI, NO buttons, NO interface panels, NO scoreboards, NO people, NO playing cards (floating ace cards will be separate live elements). This image will be a background texture for a functioning application, not a screenshot or mockup.
Avoid: arcade, rainbow colors, cyberpunk streets, sci-fi machinery, excessive neon, purple fog filling the center, huge objects blocking the UI, overexposed lights, lens flares, watermarks.
```
