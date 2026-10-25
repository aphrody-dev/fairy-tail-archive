# Références immersives 3D — consolidation 2026

**Décision utilisateur ultérieure : WebGPU natif obligatoire.** Les recommandations initiales de conserver le renderer WebGL sont remplacées par le moteur partagé `packages/gpu`. L’accueil et la visionneuse réutilisent ce propriétaire, sans second moteur WebGL. Les références esthétiques et leurs preuves restent pertinentes ; elles ne déterminent pas notre API graphique.

Relevé du **25 octobre 2026**, Europe/Paris. Sélection destinée au projet Fairy Tail, sans prétendre établir un classement universel des « plus beaux sites ». La pertinence indiquée est notre appréciation de conception ; les dates, crédits et technologies viennent des sources liées.

## Méthode et limites

Sept fiches primaires Awwwards ont été lues : date de distinction, crédits, liens vers les sites, tags techniques et éléments d’interaction documentés. Les URL publiques ont été ouvertes sans compte. Les pages Awwwards qui échouaient dans l’outil de navigation ont été récupérées en HTTP et analysées comme HTML inerte avec Bun, sans exécuter leurs scripts. Nous n’avons ni mesuré les FPS, ni inspecté leurs bundles, ni vérifié toute leur expérience mobile. Les mentions de WebGL/Three.js ci-dessous sont des tags de la fiche, pas une déduction depuis une capture.

Les dépôts GitHub ont été vérifiés par leurs pages et l’API publique, y compris branche par défaut, dernier commit de cette branche, dernière poussée et licence. Une poussée récente peut concerner une autre branche : elle ne constitue pas à elle seule un signe de version publiée. Aucune dépendance n’a été installée dans le monorepo pour ce benchmark.

## Comparaison des sites

| Référence et preuve datée | Langage visuel / interaction documentée | Ce qui sert Fairy Tail | Coût et limite de transposition |
|---|---|---|---|
| **[Cartier Watches & Wonders 2026](https://www.cartier.com/en-fr/watchesandwonders)** — Immersive Garden. [SOTD du 25 mai 2026](https://www.awwwards.com/sites/cartier-watches-wonders-2026), 7,53/10. | Parcours par univers ; fiche illustrant le défilement entre univers et les pages produit. Tags Three.js, GLSL, Blender et 3D. | Traiter manga, anime et jeux comme des destinations visuelles reliées par une transition spatiale cohérente. Navigation discrète, scène dominante. | Élevé si chaque univers nécessite des modèles et une direction artistique dédiés. Ne pas attribuer à Fairy Tail les décors ou symboles Cartier. |
| **[Oryzo AI](https://oryzo.ai/)** — Lusion. [SOTD du 13 avril 2026](https://www.awwwards.com/sites/oryzo-ai). | La fiche documente explicitement la transition 3D→2D→3D, les révélations et les particules interactives. Tags WebGL, GSAP, Three.js. | Garder une continuité entre scène, illustration originale et fiche de contenu, plutôt que sauter entre des écrans sans relation. | Élevé pour un véritable objet 3D ; moyen pour des transitions d’images. La profondeur d’un personnage ne peut pas être inventée à partir d’une affiche. Le ton satirique du site n’est pas à reprendre. |
| **[21 Hrs On The Moon](https://www.21hrs.space/)** — Studio 28K et Set Snail. [SOTD du 10 juillet 2026](https://www.awwwards.com/sites/21-hrs-on-the-moon). | Carte interactive, galerie panoramique, galerie photo et séquences sonores attestées par les éléments de la fiche. Tags 3D, WebGL, Sound-Audio. | Modèle le plus pertinent pour explorer un corpus riche : les lieux ou scènes servent de points d’entrée vers images, personnages et documents. | Élevé pour une vraie carte spatiale ; moyen pour une carte éditoriale de scènes existantes. Le lien spatial entre contenus doit venir des données, pas de faux lieux canoniques. Son uniquement après activation volontaire. |
| **[GQ & AP — The Extraordinary Lab](https://www.gq.com/sponsored/story/the-extraordinary-lab)** — Immersive Garden. [SOTD du 26 mars 2026](https://www.awwwards.com/sites/gq-ap-the-extraordinary-lab). | Expérience éditoriale 3D autour de l’horlogerie ; tags WebGL, Nuxt.js, Blender et interactions gestuelles. La page GQ expose trois chapitres et une activation du son. | Chapitres visuels pour les arcs, un seul mouvement de caméra ou de transition par passage ; détails textuels sur demande. | Élevé avec modèle animé ; moyen avec médias sourcés. Copier le framework Nuxt n’apporterait rien au monorepo React existant. |
| **[Julien Calot](https://www.juliencalot.com/)** — Flot Noir, Clément Merouani et Moussa Mamadou. [SOTD du 8 juillet 2026](https://www.awwwards.com/sites/julien-calot). | Galerie plein écran infinie et bascule liste/grille documentées. Tags WebGL, Webflow, Gallery, Big Background Images. | **Priorité immédiate** : galerie d’images généreuse, exploration visuelle des couvertures, scènes, fanarts et jeux, détails uniquement à l’ouverture. | Moyen. Le mécanisme de galerie est transposable sans Webflow. Le défilement infini ne doit pas charger toutes les images ni remplacer une pagination accessible. |
| **[Lacoste Ace Breaker](https://members-play.lacoste.com/ace-breaker-rg/)** — Merci-Michel. [SOTD du 3 août 2026](https://www.awwwards.com/sites/lacoste-ace-breaker). | Jeu plein écran, navigation inhabituelle et contrôles autour du contenu. Tags Three.js, 3D, WebGL, Games. La [présentation de Merci-Michel](https://vimeo.com/1198434976) confirme le projet. | Référence pour des icônes persistantes, un état actif clair et une interface qui laisse la scène occuper l’écran. | Très élevé pour recréer un jeu ; faible à moyen pour le langage de commandes. Notre consultation n’implique ni inscription, ni participation aux récompenses. |
| **[Shopify — The Renaissance Edition](https://www.shopify.com/editions/winter2026)** — Shopify Design et collaborateurs. [SOTD du 9 février 2026](https://www.awwwards.com/sites/the-renaissance-edition). | Parallaxe, transition d’introduction et révélation de couche cachée documentées. Tags Blender, WebGL, 3D et animation. | Référence utile pour des compositions illustrées en plusieurs plans, uniquement lorsque les calques ou masques existent réellement. | Élevé en production artistique. **Ce n’est pas un lancement de 2026** : Shopify l’annonce le [10 décembre 2025](https://www.shopify.com/news/winter-26-edition-merchant). Son titre Winter ’26 ne suffit pas à dater sa création. Les peintures génératives du site ne répondent pas à l’exigence d’assets Fairy Tail sourcés. |

Les dates ci-dessus sont des **dates de distinction**, pas des dates de mise en ligne certifiées. Bruno Simon, Lusion ou Active Theory peuvent être des références majeures, mais leur notoriété ne justifie pas de les annoncer automatiquement « sites de l’année 2026 ». Les listes secondaires trouvées dans la recherche contenaient des affirmations de ce type ; elles n’ont pas servi de preuve.

## Dépôts GitHub vérifiés

Les cinq premiers dépôts constituent la comparaison technique. Les licences indiquées sont celles constatées à la date du relevé ; elles ne valent pas licence pour les modèles, images, sons ou marques des sites présentés plus haut.

| Dépôt | Licence et activité observées | Utilité concrète | Décision pour le monorepo |
|---|---|---|---|
| **[mrdoob/three.js](https://github.com/mrdoob/three.js)** | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE). Branche `dev` : [fae87345](https://github.com/mrdoob/three.js/commit/fae873455dff9602a916b4d2e8a985921448b62a), 24 octobre 2026. Dernière poussée observée : 24 octobre. | Moteur 3D et chargeurs pour de vrais modèles, scènes et matériaux. Les exemples du dépôt sont un catalogue technique, pas un design system. | Candidat si le produit obtient des modèles ou scènes 3D réels. Ne pas migrer le rendu existant uniquement pour animer des rectangles. Coût : nouvelle couche de rendu et gestion mémoire GPU. |
| **[pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber)** | [MIT](https://github.com/pmndrs/react-three-fiber/blob/master/LICENSE). Branche `master` : [d74622ea](https://github.com/pmndrs/react-three-fiber/commit/d74622ea8ed717f7212d7e19d65ff3e325508389), 14 octobre 2026. Dernière poussée : 21 octobre. | Renderer React pour Three.js. Sa [documentation de performance](https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/scaling-performance.mdx) traite notamment du rendu à la demande et de l’adaptation de qualité. | Bonne intégration déclarative avec React, en conservant Base UI/Tailwind en DOM. Compatibilité exacte avec React 19.3.1 et le bundler Bun à qualifier dans un prototype, pas certifiée ici. Ajoute Three.js et le renderer. |
| **[pmndrs/drei](https://github.com/pmndrs/drei)** | [MIT](https://github.com/pmndrs/drei/blob/master/LICENSE). Branche `master` : [bf6f4add](https://github.com/pmndrs/drei/commit/bf6f4addf47467d3885de272d94ca5127f6ef68f), 30 septembre 2026. Dernière poussée : 21 octobre. | Helpers de R3F ; `useGLTF` et `PerformanceMonitor` sont documentés dans le [README](https://github.com/pmndrs/drei#readme). | Optionnel et ciblé : importer les helpers nécessaires, sans activer tous les effets. N’a d’intérêt que si R3F est retenu. |
| **[oframe/ogl](https://github.com/oframe/ogl)** | `Unlicense` déclarée dans le [README](https://github.com/oframe/ogl#unlicense) et le [package](https://github.com/oframe/ogl/blob/master/package.json). L’API GitHub renvoie pourtant `license: null` : ne pas confondre détection automatique et déclaration. Branche `master` : [385ce65c](https://github.com/oframe/ogl/commit/385ce65c352c70734a36dc98c787fdd1d30ddb3b), 13 avril 2025 ; dernière poussée identique. | Petite abstraction WebGL sans dépendance annoncée par le README, intéressante pour shaders et plans texturés. | Alternative technique à Three pour un rendu très spécialisé. Activité de branche plus ancienne ; **pas un dépôt créé ou mis à jour en 2026**. Notre moteur natif couvre déjà une partie de cette fonction, donc intérêt limité à court terme. |
| **[pmndrs/react-three-rapier](https://github.com/pmndrs/react-three-rapier)** | [MIT](https://github.com/pmndrs/react-three-rapier/blob/main/LICENSE). Branche `main` : [ae5c3fed](https://github.com/pmndrs/react-three-rapier/commit/ae5c3fede5ca489fd7eaa8271e9d9c5eabc88e98), 3 novembre 2025. Dernière poussée du dépôt : 12 octobre 2026. | Liaison React/R3F pour la physique Rapier. Pertinent pour une expérience de jeu avec collisions. | **Pas nécessaire pour la galerie ou le lecteur.** À réserver à une future interaction où les collisions servent réellement le contenu. Coût supplémentaire : simulation et chargement du moteur physique. |

Référence pédagogique séparée : **[Bruno Simon — My Room in 3D](https://github.com/brunosimon/my-room-in-3d)**. Le [package](https://github.com/brunosimon/my-room-in-3d/blob/main/package.json) indique `UNLICENSED`, et non `Unlicense`. Le dernier commit de `main`, [5d00b3f8](https://github.com/brunosimon/my-room-in-3d/commit/5d00b3f870da81f103e901e0d12e20bbcc816834), date du 13 septembre 2021 ; dernière poussée du dépôt le 12 septembre 2023. Utile pour étudier une pièce conçue comme scène, **pas une base de code ou d’assets à incorporer** et pas une nouveauté 2026.

Les bibliothèques libres listées ne nécessitent pas d’abonnement logiciel déclaré dans cette comparaison. Cela ne chiffre ni production des assets, ni hébergement, ni développement. Aucun poids de bundle ni coût GPU n’est inventé : ces valeurs doivent être mesurées sur notre build réel.

## Ce que le monorepo possède déjà

Lecture locale de `apps/home/renderer.ts`, `SceneCanvas.tsx`, `scene.ts` et `package.json`, sans modification ni exécution de l’application :

- `SceneRenderer` utilise déjà WebGL2, une caméra perspective, des plans texturés et des masques. Son propre commentaire précise qu’il ne produit ni maillage inféré ni profondeur neuronale.
- Il observe la visibilité, gère perte de contexte, annulation et destruction, et initialise la pause depuis `prefers-reduced-motion`.
- `SceneCanvas` conserve une image de repli lorsque le rendu n’est pas prêt et transmet les commandes de pause et de zoom.
- React et les packages `@fairy/ui` et `@fairy/tailwindcss` sont déjà les propriétaires de l’interface. Remplacer cette architecture pour suivre une mode ajouterait du travail sans garantir une meilleure image.

Conclusion technique : **réutiliser le moteur existant pour une mise en scène 2,5D explicitement identifiée**, puis évaluer Three/R3F seulement pour des assets possédant une vraie géométrie. Une image inclinée ou un fond flouté restent une image mise en scène ; aucun effet ne les transforme en scène de l’anime reconstruite fidèlement.

## Consolidation proposée pour Fairy Tail

### Priorité 1 — contenu dominant et navigation visuelle

La combinaison la plus pertinente est **Julien Calot pour la galerie**, **21 Hrs pour l’exploration du corpus** et **Cartier pour les transitions entre univers**. Le contenu doit occuper la majorité de l’écran ; une rangée ou colonne compacte d’icônes donne accès au manga, à l’anime, aux jeux, au corpus communautaire et aux réglages. Chaque icône garde un nom accessible, une infobulle au focus comme au survol et un état actif identifiable.

Préférer une grille de couvertures, scènes et portraits à une liste de titres techniques. Les informations de provenance, langues et disponibilité sont accessibles dans le détail, sans envahir la première vue. Les cartes sont générées à partir du catalogue et des médias réellement disponibles ; une absence d’image ne doit pas déclencher un faux visuel « officiel ».

Le corpus doit accueillir **officiel et communautaire**, avec des classes séparées : éditeurs, sites anime/jeux, diffuseurs, wikis, fanarts et autres contributions. Une contribution de fan ne devient pas officielle par son intégration à la même galerie. Conserver auteur lorsqu’il est connu, URL de provenance, langue, date et état d’accès. Les compteurs viennent de l’API locale ; les 298 publications, 89 documents wiki et 30 entrées anime signalés par le parent sont une couverture locale du moment, pas la totalité mondiale de Fairy Tail.

### Priorité 2 — continuité spatiale et profondeur justifiée

Utiliser les scènes et masques déjà indexés pour une transition courte entre galerie et scène. Les surfaces de lecture restent planes, nettes et zoomables : la transformation d’entrée se termine avant la lecture. La caméra ne masque pas la navigation et n’empêche ni défilement, ni zoom natif, ni fermeture au clavier.

Pour une scène comportant de vrais calques, laisser apparaître leur profondeur par un déplacement mesuré. Si nous n’avons qu’une illustration plate, afficher cette illustration entière. Pas de relief inventé, pas de faux personnages séparés, pas de morphing du dessin original pour simuler une animation de l’anime.

### Priorité 3 — vraie 3D, conditionnée par les assets

Un passage dans une salle de guilde ou un objet navigable ne devient un chantier pertinent que si un modèle réutilisable, sa provenance et ses matériaux existent. Dans ce cas, un prototype Three.js/R3F peut comparer chargement, qualité et coûts au moteur natif. Le choix de bibliothèque vient après cette preuve, pas avant. Rapier reste hors du socle tant qu’un mécanisme de jeu concret ne l’exige pas.

### Critères de validation proposés

Ces critères sont des **objectifs de projet à mesurer**, pas des performances constatées des références :

- Première image utile immédiatement depuis le HTML ou un repli, avant initialisation 3D ; un chargeur spectaculaire ne remplace pas du contenu.
- Charger les miniatures visibles, puis la source sélectionnée ; ne pas précharger des centaines d’images ni plusieurs scènes GPU simultanément.
- Mesurer sur téléphone modeste avant d’ajouter des particules, flous ou reflets ; réduire résolution et effets lorsque le budget est dépassé. Ne pas rendre en continu une vue immobile.
- Respecter `prefers-reduced-motion`, proposer pause, arrêt du son et accès direct à la source ; garder une voie de navigation DOM complète sans WebGL.
- Test clavier : toutes les icônes atteignables, focus visible, Échap et restauration du focus, cibles tactiles d’au moins 44 × 44 CSS px selon la recommandation UI adoptée dans le projet.
- Aucun engagement de fidélité pixel par pixel sans une capture de référence déterminée, une taille de viewport fixée et une comparaison mesurée.

## Éléments volontairement non consolidés

Pas de classements « Site of the Year 2026 » repris de listes non primaires ; pas de dépendance installée sur la base d’un tag Awwwards ; pas de récupération des bundles, modèles ou textures des références ; pas de coût ou de licence déduit de la seule accessibilité d’un fichier ; pas d’affirmation que tous les sites ont été parcourus visuellement et testés sur appareil.
