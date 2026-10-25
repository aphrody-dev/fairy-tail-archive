# Coordination de la homepage et du backend

Mis à jour le 25 octobre 2026 après le branchement de la route des images de référence.

## Contrats stables

Le backend d’archive tourne sur `http://127.0.0.1:3000`. L’autre fil possède la fusion frontend de la homepage et de la galerie dans l’expérience WebGPU partagée. Cette intégration consomme les routes ci-dessous et évite une seconde copie des données.

| Contenu | Contrat de lecture |
|---|---|
| Accueil et identité | `/`, `/home/*`, `/api` |
| Recherche et RAG | `/search`, `/ask`, `/native/search`, `/index/status` |
| Bibliothèque et éditeurs | `/library`, `/manga/volumes`, `/manga/volumes/:isbn/pages`, `/manga/volumes/by-id/:id/pages`, `/cdn/manga/:assetId` |
| Catalogue anime | `/anime`, `/anime/works`, `/anime/works/:workId`, `/anime/catalog/status` |
| Arcs narratifs | `/anime/arcs?lang=fr`, avec `en` et `ja` également disponibles |
| Wiki | `/wiki`, `/wiki/:id` |
| Scènes WebGPU | `/scenes`, `/scenes/:id/manifest`, `/scenes/:id/assets/:assetName` |
| Vidéo et flux | `/streams`, `/streams/:id`, `/streams/:id/play`, `/streams/:id/file`, `/episodes/:id/video`, `/episodes/:id/frames` |
| Capacités et schémas | `/media/capabilities`, `/openapi.json`, `/graphql`, `/graphql/schema` |
| Images du registre de sources | `/references/:sourceId/:index` : URL répertoriées uniquement, taille plafonnée à 8 Mio, ETag et cache local |

La route des images est câblée dans `apps/api/main.ts` et documentée dans OpenAPI. Elle accepte les méthodes GET et HEAD, refuse les redirections, borne l’attente à 15 secondes et met en cache un maximum de huit réponses. Le contrôle de types Bun a passé sur le backend et le contrat. La relance du serveur est à faire lors de l’intégration du build homepage.

Le plugin MCP conserve neuf outils en lecture seule. `fairy_tail_library` expose aussi les kinds `anime_works`, `anime_work`, `anime_arcs` et `anime_catalog_status`. Ces lectures ne démarrent aucune collecte et ne font aucun DDL.

## Corpus et provenance

Index actuel prêt : **547 documents, 4 622 passages et 4 621 vecteurs**, révision SQLite 29 817, génération 2026-10-25T00:29:51.601Z. Corpus digest `970547dab3e55ad1d261bcb8ac2322e4b710e80060dbacd5cce6c7fa6f5379cf`. Export Shenron : `data/fairy-tail-corpus.jsonl`, 547 documents. Les trois articles Fandom FR du rapport `data/wiki/retry-import-report.json` ont été repris depuis le cache, sans nouvelle requête réseau.

Catalogue anime communautaire : 10 fiches, 720 liens répertoriés. La série principale expose 328 références VF et 328 VOSTFR sans trou ni doublon. La fiche OAV annonce huit épisodes pour neuf liens ; cet écart reste visible dans l’audit. 100 Years Quest compte 25 liens par langue. Ces pages fournissent des métadonnées, pas les vidéos.

Arcs : 25 entrées FR, 28 EN et 18 JA. Les découpages restent propres à chaque source et langue. Les plages manga japonaises ne deviennent pas des numéros d’épisode. Aucune saison n’est inférée.

Manga : 12 images lisibles de l’extrait Pika en cache. Le manifeste du chapitre Kodansha liste 81 pages, sans image lisible acquise. Les 93 références manga de l’API ne sont donc pas 93 images acquises.

Vidéo : le flux 88 est un MP4 promotionnel public de 37,93 secondes ; 908 images ont été indexées. La homepage lit le fichier local et l’import reprend par empreintes. Aucun épisode complet n’en est déduit. Le runtime remuxe certaines configurations MP4 ; il a refusé le MP4 promotionnel Netflix à cause de sa configuration de pistes. HLS natif et transcodage sont absents du binaire qualifié. Aucun manifeste HLS/DASH Fairy Tail valide n’a été confirmé.

## État WebGPU

L’adaptateur frontend réutilise le moteur partagé `packages/gpu`. La scène active trois plans, un masque et deux textures SVG rasterisées en PNG après validation SHA. Les SVG d’origine restent la provenance. Le navigateur a confirmé les pipelines render, compute et particules, le passage manga/anime, le clavier, le zoom, la pause et la réinitialisation. Captures : `apps/home/references/home-desktop.jpg` et `apps/home/references/home-mobile.jpg`.

Le lecteur local affiche le flux promotionnel sur `/streams/88/file`, avec `readyState=4`, durée 37,93 secondes et 908 images indexées. La page wiki et son résultat de recherche restent reliés au backend. Le repli affiche l’image source si WebGPU est indisponible.

## Prochain lot partagé

1. Fusionner le shell de la homepage avec la galerie dans un seul parcours WebGPU.
2. Utiliser les routes de bibliothèque et de catalogue ci-dessus pour anime et arcs, sans recopier les données.
3. Vérifier recherche, favoris, wiki, provenance et lecteur vidéo dans l’expérience fusionnée sur desktop et mobile.

## Vérifications de référence

La dernière campagne backend comptait 118 tests réussis, aucun échec et un test Koharu ignoré faute de SDK. `bun check --threads=2` couvrait 890 fichiers. Lint et format ciblés passaient ; le configurateur du plugin confirmait les chemins. La homepage a passé le build et le QA natif WebView desktop/mobile.

## Frontend : monde WebGPU, 25 octobre

L’entrée canonique ouvre la nouvelle halle en volume et trois ailes manga/anime/jeux. Propriétaires : `packages/gpu/WorldRenderer.ts`, `world-geometry.ts`, `world-math.ts`, `world-shaders.ts`, `packages/experience/WorldSurface.tsx`. Contrats backend inchangés ; 21 textures officielles passent par `/references` (W24, W01, W14). Les deux textures W16 essayées renvoyaient 502 et ne sont plus exposées dans le monde. L’API a été relancée sur 3000 après constat de connexion refusée. Les fonctions lecteurs/recherche/bibliothèque restent celles des contrats ci-dessus. La tentative de notification au chat backend a indiqué que celui-ci est archivé ; cette note garde la coordination consultable sans le réactiver.
