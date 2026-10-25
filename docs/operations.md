# Exploitation locale

Pour le travail en cours et les critères de fermeture, voir le [plan de livraison](plan.md).

## Démarrage et contrats

```powershell
bun agent-plugin doctor --json
bun apps/home/build.mjs
bun start
```

Le serveur écoute sur 127.0.0.1:3000. La page d’accueil utilise les textures et contours SVG mesurés dans les images réellement en cache. Son relief est une scène de plans 2.5D avec caméra WebGPU, sans profondeur neuronale. Les SVG sont décodés en textures PNG bornées, après vérification de leur empreinte ; cette étape de décodage ne constitue pas un moteur de rendu 2D de remplacement. L’image source reste affichée lorsque WebGPU est indisponible. Le lecteur manga, la sélection vidéo, le wiki et les sources sont accessibles depuis cette page. Le bundle se trouve dans target/home.

Dernier index qualifié : **547 documents, 4 622 passages, 4 621 vecteurs**, révision SQLite 29 817, généré le 25 octobre 2026 à 00:29 UTC. L’export de corpus contient 547 documents. Une nouvelle ingestion rend l’index obsolète jusqu’à la prochaine commande `bun index`.

API de lecture : /library, /manga/volumes, /manga/volumes/:isbn/pages, /manga/volumes/by-id/:id/pages, /anime, /anime/works, /anime/arcs, /wiki, /wiki/:id, /scenes, /streams, /references/:sourceId/:index, /search et /ask. La route references sert uniquement les images répertoriées au registre officiel, avec cache local et ETag. OpenAPI est servi sur /openapi.json ; GraphQL et son SDL sur /graphql et /graphql/schema. GraphQL.js 17.0.2 est la bibliothèque de référence ciblée autorisée pour le protocole ; stockage, récupération et traitement médias restent natifs.

Les réponses HTTP portent un identifiant de requête, Server-Timing et les en-têtes de sécurité. Les routes natives coûteuses ont un plafond de 4 requêtes simultanées et un budget de 12 requêtes avec recharge d’une requête par seconde. Le module natif limite également ses sous-processus à 4, avec 32 attentes maximum. Les erreurs inattendues ne divulguent pas de requêtes SQLite. SIGINT/SIGTERM déclenchent un arrêt borné, puis la fermeture SQLite et des enfants natifs.

## Collectes et index

Les commandes ci-dessous ont des budgets explicites. Consulter leur rapport et leur état avant de relancer ; les catalogues ne sont pas des fichiers médias acquis.

```powershell
bun run cli coverage
bun run cli wiki-crawl 20
bun run cli pika 20
bun run cli manga-import 1 12
bun run cli manga-kodansha
bun run cli streams-sync
bun run cli stream-import 88
bun run cli anime-sync 20
bun run cli anime-arcs-sync 3
bun run cli anime-works
bun run cli media-capabilities
bun run cli scene-build 32
bun index
bun run cli native-export data/fairy-tail-corpus.jsonl
```

L’index natif vérifie la révision SQLite, l’identité du corpus et les empreintes avant de servir les vecteurs. Une collecte postérieure rend cette génération obsolète ; reconstruire après la fin des collectes. La recherche hybride rapporte son repli lexical lorsqu’il est nécessaire. Les vecteurs sont un encodage lexical haché ; le classement RRF s’exécute dans aphrody-rag-core. Le RAG Python est extractif et cite les passages, sans prétendre disposer d’un LLM ou d’embeddings neuronaux.

Le pont Rust Shenron utilise les fonctions ABI de découpage, sans charger son corpus Dragon Ball. La disponibilité ABI et les capacités réellement compilées sont exposées par /native/status. Les chemins propres à la machine sont configurés localement dans .config/fairy-tail-native.json. Le SDK Koharu n’est pas installé sur cet hôte ; aucun export Koharu n’est annoncé comme effectué.

## Médias et provenance

### Catalogue anime et arcs

`bun run cli anime-sync 20` explore les sitemaps observés de la source Voiranime indiquée par l’utilisateur. La collecte du 25 octobre a enregistré 10 fiches et 720 entrées : 328 VF et 328 VOSTFR pour la série principale, 25 VF et 25 VOSTFR pour 100 Years Quest, 9 OAV et les liens de films, prologue et crossover. Ces variantes de langue ne sont pas des œuvres distinctes. Les métadonnées restent marquées `unofficial`, avec snapshots, empreintes et audit de numérotation. La fiche OAV annonce 8 épisodes pour 9 liens ; le désaccord est conservé. Aucune page de lecteur tiers ni fichier vidéo de cette source n’a été acquis.

`/anime/works`, `/anime/works/:workId` et `/anime/catalog/status` exposent ce catalogue paginé. `/anime/arcs?lang=fr` expose les arcs avec source, révision et plages exactes observées : 25 entrées FR, 28 EN et 18 JA. Il s’agit de 71 descriptions dans plusieurs langues, avec découpages différents ; ces lignes ne sont pas 71 arcs uniques. Les saisons fournisseur ne sont pas déduites des sagas. Les plages japonaises de volumes manga restent distinctes des épisodes.

Le MCP `fairy_tail_library` expose ces lectures via les `kind` anime_works, anime_work, anime_arcs et anime_catalog_status, sans collecte implicite.

### Conversion native

`/media/capabilities` et `bun run cli media-capabilities` distinguent présence d’API et qualification réelle. `media-plan <episode-id>` prépare une opération bornée, et `media-remux <episode-id>` remuxe vers MP4 avec empreintes et validation du résultat. La petite fixture H.264 silencieuse passe ; le MP4 promotionnel Netflix est refusé par le moteur pour sa configuration de pistes. Aucun succès de remux n’est annoncé pour ce fichier. Les API HLS et transcodage ne sont pas présentes dans le binaire qualifié, et les extensions MKV/WebM/MOV ne suffisent pas à prouver un format. Voir aussi [les capacités médias](media-capabilities.md).

L’extrait public Pika du tome 1 contient 12 pages, toutes mises en cache. Le catalogue rassemble 93 références de pages manga, mais ce total comprend des pages dont l’image n’est pas acquise. Cela ne constitue pas un tome complet. Le chapitre japonais officiel référence 81 pages dans son manifeste ; ses ressources CDN obfusquées restent `reader_only`. La capture normale du lecteur n’a pas passé la vérification de lisibilité sur cet hôte ; aucune de ces images n’est déclarée acquise.

Les sources observées comprennent 41 embeds YouTube officiels et un MP4 promotionnel public Netflix. Les enregistrements `watch` et `embed` peuvent désigner la même vidéo. Aucun manifeste HLS/DASH Fairy Tail exploitable n’a été confirmé. Le lecteur HLS et son worker réutilisent les assets du propriétaire Bun Video installé ; le binaire qualifié ne sait pas produire HLS natif.

Le MP4 promotionnel importé comme flux 88 produit 908 images, à cadence 24000/1001, soit 975 775 606 octets de PNG. Il ne représente pas un épisode complet. La reprise contrôle les empreintes et ne redécode pas les images déjà validées. Les imports imposent des limites de téléchargement, durée, nombre d’images et taille de sortie. `/streams/88/file` et les routes `/episodes/:id/video` servent le cache avec HTTP Range natif ; les CDN d’images sont également cache-only.

## Contrôles

```powershell
bun test tests
bun check --threads=2
bun lint
bun fmt --check
bun apps/home/qa.mjs
bun run plugin:configure --check
```

Les tests de média utilisent une petite fixture locale, les tests de concurrence des enfants simulés et le test de pont Rust la DLL native installée. Le test SDK Koharu est explicitement ignoré lorsque le SDK manque. Les collectes réseau de production restent séparées des tests.

Le plugin local expose 9 outils MCP de lecture sur stdin/stdout ; son outil `fairy_tail_library` donne aussi accès aux fiches anime et aux arcs. Ses chemins absolus sont générés par `bun run plugin:configure`. Il peut être lancé depuis un autre répertoire de travail sans modifier le corpus.
