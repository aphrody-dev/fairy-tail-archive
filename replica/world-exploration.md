# Univers explorable WebGPU

L’entrée `http://127.0.0.1:3000/` ouvre désormais une architecture 3D parcourable, rendue par `packages/gpu/WorldRenderer.ts`. Le décor comporte une halle, une voûte avec ouverture centrale, des poutres, colonnes, arches ouvertes, tables, bancs, comptoir, fenêtres, étagères et trois ailes. Les œuvres ne servent plus de fond de page.

## Provenance et limites de fidélité

Les 21 œuvres exposées sont sélectionnées dans le catalogue généré, sans construire d’URL d’image distante : sept couvertures de Star Comics W24, sept images de l’anime officiel W01 et sept visuels du jeu officiel W14. Le rendu appelle exclusivement `/references/:sourceId/:originalImageIndex`. Chaque œuvre conserve URL originale, page source, classe et indice du catalogue. Le ratio est mesuré au décodage et utilisé pour reconstruire sa géométrie. Les images W16 renvoyaient HTTP 502 et ont été exclues de cette sélection ; leur source reste consultable dans le catalogue.

L’architecture est une création spatiale inspirée de la guilde, pas un modèle 3D officiel acquis ni une restitution canonique mesurée de Magnolia. Les personnages et couvertures exposés restent des images officielles sur des surfaces 3D ; aucun personnage volumétrique officiel n’a été acquis. Le logo de l’interface reste celui collecté chez TV Tokyo W03. Les noms des salles sont des libellés de navigation de cette application.

## Interaction

- Clic sur une arche : trajet continu vers son aile ; les icônes manga, anime et jeux commandent les mêmes trajets.
- Glisser dans la scène : orientation de la caméra. Flèches ou WASD après focus du canvas : marche. Molette : déplacement avant/arrière. Contrôles directionnels maintenus : marche tactile ou clavier.
- Clic sur une œuvre ou bouton Examiner : visuel source et provenance. Entrée ouvre l’œuvre proche. Échap ou retour : halle.
- Lecteur d’extraits manga, vidéos, bibliothèque, sources, recherche, wikis et favoris restent reliés aux API existantes. L’icône de couches ouvre les scènes multicouches antérieures.
- Les lecteurs et la recherche suspendent le déplacement. Le temps d’un trajet est gelé pendant la pause et l’onglet caché.
- Avec réduction des mouvements, le changement de salle est immédiat et la proximité de l’œuvre est actualisée sans boucle d’animation continue.

## Moteur

WebGPU natif, sans WebGL : tampon de sommets intercalés, vraie profondeur, carte d’ombres `depth32float` 1024² avec filtrage PCF, éclairage par paliers, contours extrudés, tableau de textures et MSAA ×4. Trois passes : ombres, contours et surfaces. Les bind groups des passes d’ombres et de lecture sont séparés pour ne pas échantillonner une texture encore attachée en écriture.

Les textures sont limitées à 512² par couche, trois chargements simultanés, avec abandon lors de la destruction du moteur. La géométrie respecte le ratio d’origine après décodage. Le rendu plafonne le DPR à 1,5 et le tampon à deux millions de pixels. La perte du périphérique déclenche au plus deux tentatives de récupération ; cette branche n’est pas présentée comme qualifiée sur perte physique de GPU. La disponibilité est vérifiée avant toute frame, y compris pendant les callbacks de redimensionnement. Les collisions utilisent des pas balayés pour éviter la traversée de cloisons par un mouvement important.

## Vérifications

- Build Bun et contrôle de types de l’accueil réussis.
- Tests dédiés : matrices vue/projection, sélection spatiale des arches, collisions avec grands déplacements, géométrie finie, ratio et identité de provenance.
- Navigateur intégré : pipelines WebGPU prêts, 52 590 sommets et 21 textures chargées, sans repli WebGL.
- Recherche ouverte pendant un trajet : position et compteur de frames stables ; après fermeture, reprise progressive depuis la position suspendue.

Les autres résultats d’intégration et captures sont consignés dans `fusion-experience.md`. La matrice de navigateurs, les performances sur téléphone et la perte physique de GPU ne sont pas revendiquées comme testées.

## QA final du monde

- Clic spatial dans l’arche gauche : arrivée manga `(-12, 2.8, -12)` ; marche clavier maintenue 700 ms : `z=-15.86` ; Examiner ouvre la couverture Star Comics n°21, avec le bon indice du catalogue.
- Icône Jeux : arrivée `(12, 2.8, -12)` ; l’aile anime arrive `(0, 2.8, -12)`.
- Extraits : lecteur Fairy Tail T01, 1/12 pages ; focus transféré vers la visionneuse.
- Vidéo : aperçu promotionnel `/streams/88/file`, durée 37,930667 s, `readyState=4`, sans lecture automatique.
- Scènes antérieures : icône de couches, 1/32 scènes et commandes pause/zoom/réinitialisation présentes.
- Contrôle de types : 712 fichiers ; lint ciblé : 8 fichiers sans problème ; 16 tests, 96 assertions, aucun échec.
- Revue adversariale : disponibilité GPU avant frame, collisions balayées et horloge de pause corrigées. La proximité de l’œuvre est recalculée à chaque frame, y compris en réduction des mouvements.
