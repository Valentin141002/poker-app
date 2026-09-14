# IMDCX — Phase 1 : accueil, bataille et roue

La phase 1 reprend les trois références du 13 septembre 2026. La bataille et la roue sont des vues complètes de l'application, placées dans le flux du document, avec leur propre décor, composition, titre et commandes.

## Correctif du 14 septembre : démos et retour au jeu

Les démos et les parties utilisent les mêmes vues Bataille/Roue. Les URL des ressources portent désormais la version `20260914-scenes-fix`. Après publication, recharger l'accueil avec `Ctrl+F5` pour remplacer un document ou un script conservé en cache ; cliquer sur Jouer ouvre une autre URL et ne recharge pas un ancien onglet d'accueil déjà ouvert.

Les calculs de l'échelle du jeu et de la taille des cartes sont suspendus tant que la table est masquée par une vue. Ils sont relancés au retour, après restauration du DOM, y compris si la fenêtre a été redimensionnée pendant la bataille. Un ancien recentrage différé ne peut plus faire défiler une bataille en cours. Le bouton de bataille conserve sa place pendant la révélation, et le statut réserve la hauteur du résultat pour éviter le saut vertical. Sur téléphone, la vue peut défiler même lorsque le jeu utilise son verrouillage de défilement.

Ce correctif modifie quatre fichiers à publier : `poker-app/poker.html`, `poker-app/static/js/client.js`, `poker-app/static/js/imdcx-scenes.js` et `poker-app/static/css/imdcx-scenes.css`. Le bloc complet ci-dessous les inclut. Les images, le thème du jeu et les règles serveur sont conservés.

## Ce qui change

- **Accueil** : salon noir et bleu nuit, sol réfléchissant, vrais jetons détourés, statistiques latérales, boutons biseautés, reflets et inclinaison discrète.
- **Bataille** : joueur à gauche, adversaire à droite, score en haut, VS central, cartes révélées, manches et grande action en bas. Le résultat reste visible jusqu'à « Continuer ».
- **Roue** : quatre secteurs, anneau métallique, moyeu en forme de pique, pointeur fixe, résultat et bouton « Faire tourner ». Le choix entre conserver et remplacer un multiplicateur apparaît dans cette même vue.
- **Navigation** : le gestionnaire retire la vue précédente de l'affichage et de la navigation clavier. Il restaure les mêmes éléments, le pseudo, le défilement et le focus au retour. Chaque nouvelle vue entre avec un fondu. Aucun fond d'accueil assombri ni élément dialog/aria-modal n'est utilisé pour ces deux écrans.
- **Cycle de vie** : les temporisations de présentation et les animations sont annulées au départ de la vue. Les réponses tardives d'un aperçu fermé ne remplacent pas la vue active.

Le serveur, les modules de progression, le classement et les règles de jeu ne sont pas modifiés. Les événements Socket.IO et les résultats attribués par le serveur sont conservés. La roue utilise les valeurs actuelles **x1, x2, x5, x10**, établies par la mise à jour de progression. L'aperçu reste sans effet sur les récompenses. Les statistiques de l'adversaire qui ne sont pas fournies par le serveur affichent « — ».

## Fichiers de cette mise à jour

| Fichier | Changement |
| --- | --- |
| `poker-app/poker.html` | Charge les ressources de la phase 1 avec une version de cache |
| `poker-app/static/js/client.js` | Construction et connexion des vues aux événements existants |
| `poker-app/static/js/imdcx-visuals.js` | Décor, interactions et présentation de la roue |
| `poker-app/static/css/imdcx-premium.css` | Finition de l'accueil |
| `poker-app/static/js/imdcx-scenes.js` | **Nouveau** : gestionnaire des vues |
| `poker-app/static/css/imdcx-scenes.css` | **Nouveau** : compositions Bataille et Roue |
| `poker-app/static/images/phase1-salon.webp` | **Nouveau** : salon, 184 956 octets |
| `poker-app/static/images/phase1-salon-mobile.webp` | **Nouveau** : salon allégé, 60 296 octets |
| `poker-app/static/images/phase1-poker-chip.webp` | **Nouveau** : jeton avec transparence, 71 620 octets |

Ces neuf fichiers doivent être publiés ensemble. Le script ci-dessous retransfère également le logo existant `hero-card-fan.png` pour qu'il soit bien présent. La page continue à utiliser les autres ressources de l'application déjà installée.

Les documents de `docs/` et le script de vérification servent au développement. Ils n'ont pas besoin d'être copiés sur le serveur pour changer l'interface. Le statut Git « untracked » indique qu'un fichier n'est pas encore suivi par Git ; il n'empêche pas son transfert par SCP.

## Mise à jour depuis PowerShell

Ce bloc vérifie les fichiers locaux, prépare les dossiers, transfère les ressources puis le HTML en dernier. Il s'arrête si une commande échoue. Aucun transfert n'a été effectué automatiquement par cette modification locale.

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location "C:\Users\Valentin\poker-server"

    $phase1Files = @(
        "poker-app/poker.html",
        "poker-app/static/js/client.js",
        "poker-app/static/js/imdcx-scenes.js",
        "poker-app/static/js/imdcx-visuals.js",
        "poker-app/static/css/imdcx-premium.css",
        "poker-app/static/css/imdcx-scenes.css",
        "poker-app/static/images/phase1-salon.webp",
        "poker-app/static/images/phase1-salon-mobile.webp",
        "poker-app/static/images/phase1-poker-chip.webp",
        "poker-app/static/images/hero-card-fan.png"
    )
    foreach ($phase1File in $phase1Files) {
        if (-not (Test-Path -LiteralPath $phase1File -PathType Leaf)) {
            throw "Fichier local manquant : $phase1File"
        }
    }

    ssh "root@srv1120905.hstgr.cloud" 'mkdir -p /var/www/poker-server/poker-app/static/images /var/www/poker-server/poker-app/static/css /var/www/poker-server/poker-app/static/js'
    if ($LASTEXITCODE -ne 0) { throw "Échec de la préparation des dossiers." }

    scp "poker-app/static/images/phase1-salon.webp" "poker-app/static/images/phase1-salon-mobile.webp" "poker-app/static/images/phase1-poker-chip.webp" "poker-app/static/images/hero-card-fan.png" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/images/"
    if ($LASTEXITCODE -ne 0) { throw "Échec du transfert des images." }

    scp "poker-app/static/css/imdcx-premium.css" "poker-app/static/css/imdcx-scenes.css" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/css/"
    if ($LASTEXITCODE -ne 0) { throw "Échec du transfert CSS." }

    scp "poker-app/static/js/imdcx-scenes.js" "poker-app/static/js/imdcx-visuals.js" "poker-app/static/js/client.js" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/static/js/"
    if ($LASTEXITCODE -ne 0) { throw "Échec du transfert JavaScript." }

    scp "poker-app/poker.html" "root@srv1120905.hstgr.cloud:/var/www/poker-server/poker-app/poker.html"
    if ($LASTEXITCODE -ne 0) { throw "Échec du transfert HTML." }

    Write-Host "Transfert terminé. Recharge la page avec Ctrl+F5."
}
```

Ces modifications portent sur des fichiers statiques ; aucun redémarrage Node/PM2 n'est nécessaire pour cette phase. Le HTML charge le CSS et le JavaScript des vues avec `?v=20260914-scenes-fix`.

Si l'ancienne interface apparaît encore après le transfert et `Ctrl+F5`, vérifier dans l'onglet Réseau du navigateur que `imdcx-scenes.css?v=20260914-scenes-fix` et `imdcx-scenes.js?v=20260914-scenes-fix` sont demandés et répondent en HTTP 200. Leur absence indique que le navigateur reçoit encore un ancien HTML ; une réponse 404 indique une ressource manquante ou un chemin de publication différent. La configuration de production n'a pas été inspectée pendant cette phase.

## Vérification locale

```powershell
node --check poker-app/static/js/client.js
node --check poker-app/static/js/imdcx-scenes.js
node --check poker-app/static/js/imdcx-visuals.js
node scripts/verify-imdcx-visuals.cjs
node scripts/verify-imdcx-visuals.cjs --scene-regressions
```

Le contrôle utilise Chrome et la vraie page avec des données de test locales. Il ne lance pas le serveur de jeu et n'écrit aucune donnée joueur. Les captures et le rapport se trouvent dans `build/phase1-review/`, ignoré par Git.

Le contrôle compare aussi les empreintes des fichiers serveur et progression à l'instantané pris avant ce travail. Cet instantané existe dans l'espace de travail actuel. Sur un nouveau checkout, exécuter `node scripts/verify-imdcx-visuals.cjs --capture-scope` avant de commencer de nouvelles modifications ; un instantané créé après modification ne prouve pas leur préservation.

Les scénarios couvrent les événements de bataille, les révélations, les quatre résultats de roue, les doubles clics, le choix de multiplicateur, le retour au même accueil, les transitions directes, les réponses tardives et les formats de 320 à 1913 px, dont une roue carrée de 1254 px.

Validation du 13 septembre : **292 contrôles réussis**, aucune exception JavaScript détectée. Les captures de l'accueil, de la bataille et de la roue ont été inspectées sur ordinateur et mobile. Les empreintes des fichiers serveur et progression sont identiques à celles de départ.

Validation du correctif du 14 septembre : **85 contrôles ciblés réussis** sur les démos, la stabilité de la révélation et la vraie page de table alimentée par des événements locaux simulés. La fenêtre est redimensionnée pendant la bataille, puis le retour vérifie que les mêmes commandes et cartes personnelles restent visibles. Les mesures de géométrie et de défilement sont stables pendant la révélation. Captures : `build/phase1-review/regression-table-1920x847-restored.png` et `regression-table-390x844-restored.png`. Le test ne vérifie pas la publication distante ; sur mobile, il conserve le cadrage existant du contour de table et vérifie les commandes et les cartes personnelles dans l'écran.

Les effets de pointeur utilisent `requestAnimationFrame` uniquement pendant les mouvements. Ils sont désactivés sur les pointeurs tactiles et avec `prefers-reduced-motion`. Les animations de décor se suspendent lorsque l'onglet est masqué. Les rendus utilisent des transformations et des variations d'opacité. Les images WebP de la phase 1 totalisent environ 310 Kio.

Chrome de test fonctionne avec `--disable-gpu` : ces contrôles ne mesurent pas 60 images/s sur un appareil réel ni une partie multijoueur en production.

## Origine des nouveaux visuels

Mode : génération de deux nouvelles images avec l'outil intégré `image_gen`, sans image jointe à l'appel. Les références fournies ont guidé les descriptions. Les textes, boutons, statistiques et la roue sont des éléments réels de l'application, indépendants des images.

Sorties intégrées :

- `poker-app/static/images/phase1-salon.webp` : salon original 1672 × 941, encodé en WebP ; version mobile réduite à 960 px de large.
- `poker-app/static/images/phase1-poker-chip.webp` : jeton original RGBA 1254 × 1254, réduit à 640 × 640 avec transparence conservée.

Prompt exact du salon :

```text
Use case: stylized-concept. Asset type: premium poker application background environment only, 16:9 1920x1080 landscape. Photorealistic luxury black and deep navy poker salon, symmetrical architecture with tall polished obsidian pillars and wall panels, dark metal frames, thin electric blue and purple luminous trim, magenta accent reflections, very sparse tiny warm architectural lights. Camera eye level facing a deep lounge with strong vanishing point. Dense dark architectural detail at left and right thirds, center area quietly receding into midnight blue darkness for interactive HTML controls. Glossy dark textured stone floor begins at 60 percent of height, lower 40 percent has rich purple and blue reflections and soft curved light strips like a premium poker arena. A few small glossy black poker chip stacks at the extreme lower corners only, kept in outer 10 percent of image. Main UI will cover middle 65 percent: no objects blocking it, maintain readable dark area. This is the luxurious cinematic neon poker scene used behind floating playing cards, medallions, a large wheel or 3D buttons. Render beautiful material depth and dramatic purple blue lighting like an expensive 3D product ad; elegant, clean and refined with crisp rim light. Absolutely no text, no letters, no numbers, no playing cards, no people, no buttons, no UI panels, no actual wheel, no central object, no logos, no watermark. Avoid gold palace, warm brown dominant lighting, plants, excessive neon fog, empty flat background. Need a rich black/navy architectural room with strong purple-blue reflected light.
```

Prompt exact du jeton :

```text
Use case: stylized-concept. Asset type: transparent 3D poker chip sprite for a real premium poker web application. Create ONE glossy black/navy poker chip, upright floating in air at a slight three-quarter angle, the face fully visible as a slightly tilted ellipse, thickness visible at lower right, polished dark chrome milled rim with indented slots, alternating electric blue and magenta accent inlays. Center has a single large purple luminous spade symbol embossed in dark glass. Match luxury poker concept renders: physically convincing glossy acrylic and metal, strong fine bevel highlights, subtle purple and blue reflections, beautiful premium finish, restrained glow, readable at 200px displayed size. Chip isolated and fully contained with 10 percent padding. Genuinely transparent background and alpha, no background scene, no checkerboard baked in, no floor, no text, no numbers, no extra objects. Square 1024px composition. This is an asset to composite over a real application, not a UI mockup.
```
