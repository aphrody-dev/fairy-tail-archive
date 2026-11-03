# Fairy Tail Archive — Bun OS

> A source-grounded, multilingual archive and immersive Fairy Tail experience.
> This repository contains the application and collection tooling; local
> databases, downloaded media, caches, and machine-specific configuration are
> deliberately kept outside version control.

## Project map

| Path                                                       | Purpose                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/home`                                                | Immersive WebGPU homepage and experience entry point        |
| `apps/api`                                                 | Local read API, REST/OpenAPI and GraphQL                    |
| `apps/cli`                                                 | Setup, import, indexing, catalog collection and diagnostics |
| `apps/mcp`                                                 | Read-only MCP interface for the archive                     |
| `apps/design-system`                                       | UI and GPU component catalogue                              |
| `packages/archive`                                         | SQLite archive, FTS5 and core document storage              |
| `packages/anime-catalog`, `manga`, `library`               | Anime, arcs, manga and library catalogs                     |
| `packages/crawler`, `official-sources`                     | Bounded source collection and provenance                    |
| `packages/gpu`, `scene`, `experience`, `ui`, `tailwindcss` | WebGPU scene, interaction and design system                 |
| `packages/video`, `streams`                                | Local media inspection and playback capabilities            |
| `packages/rag`, `search-index`                             | Extractive retrieval and native lexical index               |
| `tests`                                                    | Automated regression and integration checks                 |
| `replica`                                                  | Recon notes, source inventory and design research           |
| `docs`                                                     | Operations, delivery plan and capability boundaries         |

Start with [`docs/operations.md`](docs/operations.md) for commands and local
requirements, [`docs/media-capabilities.md`](docs/media-capabilities.md) for
qualified media behavior, and [`docs/plan.md`](docs/plan.md) for the current
delivery plan. Shared contributor and coding-agent guidance lives in
[`AGENTS.md`](AGENTS.md).

## Ground rules for the catalog

- Official publisher/broadcaster/platform data, community references, and
  user-provided material remain distinguishable and carry provenance.
- Coverage numbers describe observed records as of their stated snapshot; they
  do not imply a complete corpus or media ownership.
- A season listing, streaming page, embed, or CDN reference does not prove that
  an episode file was acquired. No copyrighted episode or manga is bundled.
- Local corpus files and their derivatives are reproducible only from sources
  available to the operator and remain local by default.

## Contents

- [Project map](#project-map)
- [Ground rules for the catalog](#ground-rules-for-the-catalog)
- [Setup and API](#setup-et-api)
- [Index and search](#index-natif-bun)
- [Catalogs and collection](#pika-netflix-youtube-et-fancaps)
- [Web and wiki sources](#collecte-web-fr--en--ja-et-aphrody-web-wiki)
- [Media and manga limits](#épisodes-et-images)
- [Validation](#vérifications)

Monorepo local Bun Aphrody : SQLite FTS5, recherche floue et index natif,
crawler Fandom, RAG Python extractif, pipeline Bun.Video/Bun.Image,
lecteurs manga et vidéo et scènes en relief. GraphQL.js est la bibliothèque
de référence ciblée autorisée ; aucun paquet pip n’est nécessaire.

État du corpus vérifié le 25 octobre 2026 : 547 documents, 4 622 passages,
index natif prêt (4 621 vecteurs). Export Shenron JSONL :
`data/fairy-tail-corpus.jsonl`. Le corpus reste limité aux sources et médias
explicitement importés.

Voir [le guide d’exploitation](docs/operations.md) pour la homepage, les médias
effectivement acquis, les commandes, les limites et les contrôles de qualité.
Le [plan de livraison](docs/plan.md) suit les travaux actifs et leur ordre.

## Setup et API

```powershell
bun setup
bun start
```

`bun setup` initialise les catalogues locaux et reconstruit l'index du corpus
déjà importé. Il ne télécharge pas implicitement de nouveaux médias. Le serveur
écoute uniquement sur `127.0.0.1:3000`.

- REST et OpenAPI 3.1.1 : `GET /openapi.json`.
- GraphQL : `GET` ou `POST /graphql`, schéma lisible : `/graphql/schema`.
- Catalogue communautaire : `/anime/works`, `/anime/works/:workId`,
  `/anime/catalog/status` et `/anime/arcs?lang=fr|en|ja`.
- Capacités réelles du moteur média : `/media/capabilities`.
- Bibliothèque de manga, anime et wiki : `/library`, `/manga/volumes`,
  `/anime`, `/wiki` et `/wiki/:id`.
- Catalogues : `/catalog/videos`, `/catalog/books`, `/catalog/books/status`.
- Images du registre officiel : `/references/:sourceId/:index` ; seules les
  images répertoriées sont servies, avec cache local et ETag. Redirections
  refusées, délai de 15 s et réponse plafonnée à 8 Mio.
- Références sourcées de Lucy : `/characters/lucy/references`, avec distinction
  des œuvres, provenance et limites ; les médias utilisateur restent locaux.
- Profil de personnalité demandé pour Lucy : [docs/lucy-personality.md](docs/lucy-personality.md), séparé des faits canoniques.
- Médias et conversion native : `/streams`, `/streams/player`,
  `/media/capabilities`.
- Scènes interactives 2.5D WebGPU : `/scenes`, `/scenes/status`.
- Fancaps : `/fancaps?episode=7262&offset=0&limit=100`.
- CDN local des images déjà cachées : `/cdn/fancaps/<id>` ; type réel,
  ETag, Cache-Control et requêtes conditionnelles, aucun proxy arbitraire.
- Index natif : `/index/status`, `/index/search?q=Natsu&lang=fr&limit=5`.

GraphQL.js 17.0.2 parse, valide et exécute le schéma Query avec introspection,
fragments, directives, variables et erreurs de résolution standard. Les
budgets de requête limitent la taille, la profondeur et le coût. L’API expose
un service de lecture ; ses résolveurs ne lancent aucune collecte. Exemple de
corps POST JSON :

```json
{
  "query": "query Find($q: String!) { search(q:$q,lang:\"fr\",limit:3) { title url } stats { documents } }",
  "variables": { "q": "Natsu" }
}
```

## Index natif Bun

```powershell
bun index
bun run cli index-status
```

`index` est une commande du projet utilisant directement `Bun.VectorIndex` :
vecteurs lexicaux hashés de 256 dimensions, cosinus et filtrage de langue avant
top-k. Il ne s'agit pas d'embeddings neuronaux. Les fichiers `data/search.index`
et son manifest sont liés à l'identité/révision SQLite et vérifiés par empreinte.
Après un nouvel import, reconstruire avec `bun index` ; l'API refuse un index
périmé avec HTTP 503. SQLite FTS5 et la recherche floue restent disponibles.

## Pika, Netflix, YouTube et Fancaps

```powershell
bun run cli pika 25
bun run cli pika-status
bun run cli video-sources 5
bun run cli video-catalog
bun run cli fancaps 3 3
bun run cli fancaps-status
bun run cli fancaps-cache 4911821
bun index
```

Pika : le catalogue `https://www.pika.fr/livres-fairy-tail/` est parcouru avant
les fiches. Les titres, auteurs, ISBN, dates, résumés disponibles et provenances
sont conservés ; la file SQLite reprend les fiches restantes. Aucun contenu de
tome intégral n'est supposé disponible.

Netflix : métadonnées de la page publique du titre `70266998`, épisodes visibles,
langues et saisons annoncées. Ce catalogue n'est pas une extraction des médias
protégés. YouTube : liste publique de la chaîne fournie, vrais identifiants,
durées et labels VF/VOSTFR ; continuation publique suivie lorsqu'elle est exposée.
Une vidéo VF et une VOSTFR du même numéro ne sont pas deux épisodes distincts.
`link-video <provider> <item-key> <episode-id>` rattache un item à un fichier local
déjà traité par `Bun.Video`.

Fancaps : série `7261`, pages d'épisodes et captures découvertes dans ce contexte.
La seule origine CDN acceptée est celle réellement observée pour cette série,
`ant.fancaps.net`. Les captures conservées sont des **miniatures**, avec
`full_url: null` lorsque l'original n'est pas accessible. Le cache utilise le
propriétaire natif `aphrody web mirror` puis vérifie les octets avec `Bun.Image`,
le type réel, les dimensions et SHA-256. L'extension distante `.jpg` ne prouve
pas que les octets sont JPEG. La route CDN sert uniquement ces fichiers validés.
Ce CDN local n'est pas un déploiement sur un réseau mondial.

## Collecte Web FR / EN / JA et Aphrody Web Wiki

Le binaire natif `aphrody` doit être présent dans PATH pour les commandes Wiki.
Aucun paquet npm ou pip n'est installé. Les commandes utilisent les propriétaires
Rust existants d'Aphrody : `wiki-search`, `wiki-page` et `mediawiki`.

```powershell
bun run cli wiki-seed
bun run cli wiki-crawl 50
bun run cli wiki-query fandom-fr "magie" 20
bun run cli wiki fandom-fr 200
bun run cli wiki fandom-en 200
bun run cli wiki wikipedia-ja 200 FAIRY_TAIL
bun run cli wiki fandom-fr 200 N
bun run cli sources
bun run cli web 100
bun run cli probe https://fairytail.fandom.com/wiki/Main_Page
```

`wiki-seed` recherche les personnages centraux et importe leurs dossiers natifs
(Markdown, wikitexte, sections, infobox, catégories et révision lorsqu'elles sont
disponibles). Les JSON bruts restent dans `data/wiki`, le texte et la provenance
dans SQLite. `wiki <source> <budget> [préfixe]` énumère les articles via l'API
MediaWiki. Une relance remplace les pages par URL sans doublon. Le budget et le
plafond interne d'Aphrody limitent chaque lot ; ces commandes ne garantissent
pas l'exhaustivité d'un wiki et n'exposent pas de continuation persistante.
`wiki-crawl` explore les liens internes en largeur, par dossiers natifs, avec
checkpoint et reprise par page. `wiki-query` ajoute une nouvelle recherche à
la file persistante. Les namespaces hors articles sont exclus ; le parcours
Wikipédia japonais reste limité au sujet Fairy Tail.

`web` utilise `Bun.Crawl.run`, sa file et ses checkpoints SQLite natifs dans
`data/web`. Chaque source a un périmètre : articles Fairy Tail de Wikipédia,
Fandom, anime TV Tokyo et sites/manuels de jeu officiels. Les liens hors sujet,
URLs d'édition, médias et domaines externes sont écartés avant la prochaine
requête. Les sitemaps globaux sont désactivés. Rapport : `data/web/report.json`.
Le budget est partagé entre sources ; relancer poursuit les files restantes.
Cela couvre les sources configurées, pas tout le Web.

La langue (`fr`, `en`, `ja`) est conservée par document. Recherche filtrée :
`/search?q=ナツ&lang=ja`. Le japonais utilise des bigrammes CJK indexés et des
passages découpés par caractères. Aucune traduction automatique n'est fournie.

`probe` compare HTTP, `Bun.WebDetect`, `Bun.Curl` si lié, et `Bun.WebView` sur un
navigateur Chrome/Edge isolé. Ce diagnostic ne promet pas de lever un challenge.
Sur le runtime qualifié, le curl natif est absent et WebView reste sur Cloudflare
pour Fandom ; les commandes Wiki d'Aphrody accèdent pourtant aux API FR/EN.
Les pages de challenge ne sont jamais ajoutées au corpus.

## Démarrage

```powershell
bun agent-plugin doctor --json
bun run cli init
bun run cli import examples/documents.json
bun run cli search "Natsu Dragnr"
bun run cli ask "Quelle magie utilise Natsu ?"
bun start
```

API sur `http://127.0.0.1:3000` : `/health`, `/stats`, `/search?q=...`,
`/ask?q=...`, `/episodes`, `/episodes/:id/frames?offset=0` (100 résultats).
API en lecture seule. Les imports se font en CLI. `ARCHIVE_DB` change le chemin
SQLite ; `PORT` change le port. Arrêt avec Ctrl+C.

## Fandom

```powershell
bun run cli crawl 20 fairytail.fandom.com
bun run cli crawl 20 fairy-tail.fandom.com/fr
```

API MediaWiki publique, pages du namespace principal, extraits en texte brut,
URL source conservée, réimport idempotent. Pause minimale d'une seconde entre
lots de dix pages. Lecture de robots.txt avant le crawl ; refus conservateur
des exclusions, arrêt sur HTTP 403/429, redirections ou API indisponible.
Aucun contournement antibot. Le crawler ne télécharge pas les épisodes.
Cette commande `crawl` est l'accès HTTP direct initial ; préférer les commandes
`wiki` d'Aphrody lorsque cet accès direct reçoit un 403.
La continuation est suivie pendant une exécution ; une relance repart de la
première page et met à jour les documents existants.

## Épisodes et images

Placer ses fichiers MP4 H.264 locaux dans `data/media`, puis :

```powershell
bun run cli episode data/media/episode-001.mp4
bun run cli episodes
```

`episodes` parcourt tous les MP4 du dossier, séquentiellement. Identité SHA-256
du fichier, métadonnées SQLite, cadence rationnelle d'origine, PNG pleine
résolution dans `data/frames/<id>`, timestamp et SHA-256 par image. Lots de huit
images (maximum natif : 64 images et 64 Mio). Un lot incomplet échoue sans avancer
le checkpoint ; relancer la même commande reprend au dernier lot validé.
Un épisode déjà terminé est conservé sans redécodage des images.
Ne pas lancer deux indexeurs simultanément sur le même épisode.

La sélection utilise les timestamps à cadence nominale exposés par Bun.Video.
Les vidéos à cadence variable demandent une qualification distincte : on ne
garantit pas une correspondance un à un avec chaque échantillon VFR.
Un épisode peut produire des dizaines de milliers de PNG et plusieurs dizaines
de Go. Aucun épisode n'est fourni ou téléchargé automatiquement.
Les images ne sont pas décrites par IA : pas d'OCR, reconnaissance de personnages
ou recherche sémantique visuelle sans modèle additionnel.

## RAG Python

`packages/rag/rag.py` utilise uniquement la bibliothèque standard CPython.
SQLite récupère les passages par FTS5 et titres flous ; Python classe leurs
phrases par recouvrement lexical normalisé et retourne jusqu'à trois extraits
avec références. Il s'agit d'un RAG extractif, sans LLM ni embeddings neuronaux.
Les réponses restent dans la langue du corpus.
Les questions clairement françaises, anglaises ou japonaises filtrent la langue
du corpus ; la langue peut être imposée via `/ask?q=...&lang=fr` ou
`bun run cli ask --lang=fr "Qui est Natsu ?"`.

Le pont natif `bun:python` exige un hôte CPython installé et compatible :
`BUN_PYTHON_HOST_LIBRARY`, `BUN_PYTHON_LIBPYTHON`, et sous Windows
`BUN_PYTHON_EXECUTABLE` ou `BUV_RUNTIME`. Aucun paquet pip n'est nécessaire.
Le serveur charge Python seulement pour `/ask` ; une absence du pont ne bloque
pas SQLite ou la recherche. Bun.Video exige le fournisseur natif FilmCraft.
`types/runtime.d.ts` contient des contrats étroits des API effectivement utilisées,
vérifiés contre les déclarations natives ; ce fichier ne remplace pas le SDK complet.

## Vérifications

```powershell
bun test
bun check --threads=2
bun lint
bun fmt --check
```

Les tests RAG exigent le pont CPython. Les tests d'intégration vidéo utilisent
un MP4 local lorsque `VIDEO_FIXTURE` pointe vers un fichier H.264 de courte durée.
Pas de téléchargement réseau pendant les tests. Les documents de démonstration
sont explicitement locaux ; ils ne constituent pas une archive Fandom complète.
