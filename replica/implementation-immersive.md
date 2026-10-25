# Interface immersive — état vérifié

**Mise à jour :** l’accueil et la galerie sont désormais réunis sur une seule origine et dans `packages/experience`. Le port 4173 est une redirection de compatibilité. Voir [fusion-experience.md](fusion-experience.md) pour les parcours et validations de la version fusionnée.

La demande utilisateur remplace les anciennes vitrines et la recommandation WebGL du benchmark : le moteur partagé est désormais WebGPU natif. La comparaison de sept sites et cinq dépôts reste disponible dans [benchmark-3d-2026.md](benchmark-3d-2026.md).

## Fonctionnalités présentes dans la visionneuse

- Navigation par icônes SVG, noms accessibles, focus visible et infobulles ; aucun libellé permanent dans le rail de navigation.
- Composition plein écran, images et logos sourcés, plans en perspective et transitions WebGPU ; particules ambiantes par compute shader.
- Accès manga, anime, jeux, galerie et exploration des sources ; filtre de langue et mosaïque illustrée.
- Bibliothèque paginée de publications, catalogue anime et articles communautaires ; recherche via les endpoints existants.
- Articles wiki avec liens et images effectivement présents dans le document source, taille de texte réglable et lecture progressive.
- Favoris persistants par publication, épisode ou article ; identité d’épisode distincte lorsque plusieurs épisodes partagent une URL de diffuseur.
- Lecteur de l’extrait public manga, douze pages cachées, pagination, miniatures, navigation clavier, taille d’origine et contrôles masquables.
- Dialogue de provenance : URL du fichier et de son origine, langue, dimensions et empreinte du fichier quand disponible.
- Plein écran, réduction des animations, suspension du rendu GPU hors écran/onglet masqué et repli image explicite.
- Accès à l’accueil partagé via l’icône « Univers WebGPU » : scènes multicouches, lecteur vidéo et collections anime enrichies gérés par l’autre conversation.

## Collecte supplémentaire

Le lot Pika a traité 100 requêtes avec 100 succès, portant les synopsis disponibles à 111 sur 298 publications. Le lot wiki a tenté 120 articles : 117 imports immédiats puis trois réimports depuis le cache brut, sans nouvelle requête réseau ; preuve dans `data/wiki/retry-import-report.json`.

État backend au 25 octobre : **547 documents, 4 622 segments et 4 621 vecteurs natifs prêts**, révision SQLite 29 817. Le corpus comprend les trois articles Fandom FR repris depuis le cache brut. Les 93 références de pages manga comprennent des images non acquises ; seules 12 pages Pika sont disponibles comme images lisibles. Les 908 images viennent d’un aperçu promotionnel, pas d’un épisode complet. Le catalogue communautaire Voiranime compte 10 fiches et 720 liens ; les arcs regroupent 71 descriptions FR/EN/JA. Ces nombres ne signifient pas que les vidéos correspondantes sont acquises.

## Coordination et validation

Le prochain lot actif est l’unification de la homepage et de la galerie dans une seule expérience WebGPU. La fusion frontend est suivie dans le fil propriétaire de la visionneuse. Réutiliser les APIs et données listées dans [le plan global](../docs/plan.md), sans recréer un second catalogue.

L’autre conversation, « Créer un monorepo Bun pour Fandom », possède accueil/API/backend. Elle réutilise `packages/gpu` et documente ses vérifications dans [coordination-backend.md](coordination-backend.md). Elle a confirmé l’accueil WebGPU à trois plans et un masque, des captures desktop/mobile, le lecteur MP4 public et les collections anime communautaires : dix fiches et 720 entrées de catalogue, dont des variantes linguistiques, et 71 descriptions d’arcs. Ces nombres ne sont pas des nombres d’épisodes uniques disponibles en lecture. Le décodage SVG en PNG est effectué dans l’adaptateur de l’accueil avant transfert GPU, car le binaire Bun.Image présent ne décode pas ces SVG. Les SVG sources restent conservés comme provenance. Les changements de la visionneuse, des composants et du moteur restent sous le propriétaire de cette conversation.

Contrôles natifs : check global sur 890 fichiers ; 118 tests passent avec un test Koharu ignoré car le SDK manque. La visionneuse a ses propres contrôles ciblés sur les états de navigation, favoris, WebGPU, provenance et cadrage. Le navigateur a confirmé les pipelines WebGPU, plus de 2 400 images soumises et aucune erreur console ; recherche wiki « Natsu », lecture et favoris après rechargement vérifiés. Captures : [rendu WebGPU](screens/webgpu-immersive.png), [bureau](../apps/home/references/home-desktop.jpg) et [mobile](../apps/home/references/home-mobile.jpg).

La revue adversariale a identifié une réponse wiki tardive qui pouvait rouvrir un article après navigation ; une identité de requête invalide désormais ces réponses. La récupération GPU conserve la dernière scène demandée. Les scénarios de perte physique du GPU et la matrice complète de navigateurs restent à qualifier.
