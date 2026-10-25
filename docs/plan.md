# Plan de livraison Fairy Tail

Mis à jour le 25 octobre 2026. Les fonctions ci-dessous reflètent l’état du dépôt et de son corpus local, pas les capacités espérées d’un binaire plus récent.

## Livré

- Monorepo Bun avec SQLite/FTS5, recherche floue, index natif lexical, export Shenron JSONL et RAG Python extractif sourcé. Le corpus comporte 547 documents et 4 622 passages ; son index vérifié comporte 4 621 vecteurs.
- Collecte Aphrody Wiki FR/EN/JA, recherche et plugin MCP en lecture seule. Trois dossiers FR récupérés depuis le cache brut sont inclus dans l’index courant.
- Catalogue manga/éditeur : 298 publications. L’extrait Pika du tome 1 fournit 12 pages lisibles en cache. Il ne s’agit pas du tome complet. Le chapitre japonais Kodansha a 81 pages référencées, sans images lisibles acquises.
- Catalogue anime communautaire : 10 fiches, 720 liens d’épisodes ou titres, incluant 328 références VF et 328 VOSTFR pour la série principale, 100 Years Quest, les films, le prologue, le crossover et les OAV. Les variantes de langue et les liens ne désignent pas autant de fichiers médias acquis. L’écart de la fiche OAV (8 annoncés, 9 liens) reste visible.
- Index des arcs narratifs : 25 entrées FR, 28 EN et 18 JA, avec révisions, sources et plages d’origine. Les plages manga japonaises ne sont pas transformées en numéros d’épisode.
- Homepage WebGPU partagée : trois plans, un masque, décodage SVG en PNG vérifié par empreinte, contrôle clavier/zoom/pause, et image source affichée si WebGPU manque. Scènes en relief 2.5D, pas géométrie 3D reconstruite par IA.
- Pipeline Bun.Video : 908 images du MP4 promotionnel public, reprise et hash validés ; service local compatible Range. Le scope promotionnel reste explicite.
- API REST/OpenAPI, GraphQL.js conforme avec introspection et budgets, plugin MCP à 9 outils, routes de catalogue média et protections HTTP.
- Images de référence servies depuis la même origine via `/references/:sourceId/:index` : registre connu seulement, redirections refusées, 15 s de délai maximal, 8 Mio par image, ETag et cache local.
- Baux SQLite atomiques Wiki/Fancaps, réponses tardives clôturées, cache média validé et purges de scènes obsolètes.

## Prochaines étapes

1. **Unifier l’accueil et la galerie.** La fusion frontend est le lot actif dans le fil qui possède la visionneuse et ses composants. Préserver un seul point d’entrée WebGPU et le style Fairy Tail ; intégrer navigation, recherche, bibliothèque et favoris dans une expérience continue.
2. **Brancher les catalogues à cette bibliothèque.** Réutiliser `/anime/works`, `/anime/works/:workId`, `/anime/arcs` et `/anime/catalog/status`, sans recopier les enregistrements ni confondre saisons, arcs et variantes linguistiques. Afficher les sources et leur provenance.
3. **Reprendre les détails Pika restants.** La campagne a parcouru 100 pages avec 100 succès ; 111 résumés sont disponibles sur 298 fiches. Utiliser les checkpoints existants, puis réindexer une seule fois après la campagne.
4. **Étendre les articles wiki selon une couverture explicite.** La collecte reste non exhaustive. Continuer par lots bornés, suivre les erreurs et langues, conserver les révisions et reconstruire l’index après la fin des lots.
5. **Maintenir la qualification des médias par opération.** Bun.Video sait indexer les images et remuxer certaines configurations MP4. La fixture locale de 15 images passe ; le MP4 promotionnel Netflix échoue sur sa configuration de pistes. L’API HLS native et le transcodage ne sont pas présents dans le runtime qualifié. Réévaluer après une mise à jour réelle du binaire, avec essais séparés codec, conteneur, HLS et plateformes.
6. **Qualifier les appareils et la résilience GPU restants.** La homepage est vérifiée desktop/mobile avec WebGPU actif. Compléter la matrice navigateurs/appareils et les scénarios de perte/restauration d’un GPU ; préserver le repli vers l’image source.
7. **Évaluer l’export Koharu si son SDK natif est installé.** À présent absent ; ne pas présenter le contrat 2D de Koharu comme création 3D.

## Critères de fermeture d’une campagne de données

Chaque campagne annonce son budget, ses sources, les entrées importées/échouées/en attente et ses lacunes. Les médias ne sont déclarés acquis qu’après validation des octets et empreintes. Après les écritures SQLite, lancer `bun index`, vérifier `/index/status`, puis produire `bun run cli native-export data/fairy-tail-corpus.jsonl`. Ne pas lancer un second import concurrent sur les mêmes files.

## Vérifications courantes

```powershell
bun test tests
bun check --threads=2
bun lint
bun fmt --check
bun apps/home/qa.mjs
bun run plugin:configure --check
```

État de référence à cette mise à jour : 118 tests passent, un test Koharu est ignoré car le SDK n’est pas installé. Check global : 890 fichiers. Les contenus crawlé et indexé restent bornés aux sources effectivement importées.
