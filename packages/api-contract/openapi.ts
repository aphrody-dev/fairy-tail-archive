type Schema = Record<string, unknown>;
const str: Schema = { type: "string" },
  int: Schema = { type: "integer" },
  nullable = (type: string): Schema => ({ type: [type, "null"] });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({ type: "object", properties, required });
const response = (schema: Schema, description = "Réponse JSON") => ({
  description,
  content: { "application/json": { schema } },
});
const error = response(ref("Error"), "Erreur");
const parameter = (
  name: string,
  location: "path" | "query",
  schema: Schema,
  required = false,
  description?: string,
) => ({
  name,
  in: location,
  required,
  ...(description ? { description } : {}),
  schema,
});
const id = parameter(
  "id",
  "path",
  { type: "string", pattern: "^[a-f0-9]{24}$" },
  true,
);
const get = (
  operationId: string,
  schema: Schema,
  parameters: unknown[] = [],
  extra: Record<string, unknown> = {},
) => ({
  get: {
    operationId,
    parameters,
    responses: { "200": response(schema), "500": error, ...extra },
  },
});

export function createOpenAPI(serverUrl = "http://127.0.0.1:3000") {
  const paths: Record<string, Record<string, unknown>> = {
    "/": {
      get: {
        operationId: "homepage",
        responses: {
          "200": {
            description:
              "Homepage immersive construite ; liste JSON des routes si le bundle local est absent.",
            content: {
              "text/html": { schema: { type: "string" } },
              "application/json": { schema: object({ routes: array(str) }) },
            },
          },
        },
      },
    },
    "/api": get("routes", object({ routes: array(str) })),
    "/references/{sourceId}/{index}": {
      get: {
        operationId: "officialReferenceAsset",
        description:
          "Serves a bounded cached image only when its source and image index exist in the observed official source catalog. No arbitrary URL is accepted.",
        parameters: [
          parameter(
            "sourceId",
            "path",
            { type: "string", pattern: "^[\\w-]+$" },
            true,
          ),
          parameter("index", "path", { type: "integer", minimum: 0 }, true),
        ],
        responses: {
          "200": {
            description: "Image observed in the source catalog",
            content: {
              "image/*": { schema: { type: "string", format: "binary" } },
            },
          },
          "304": { description: "ETag unchanged" },
          "404": error,
          "413": error,
          "502": error,
        },
      },
      head: {
        operationId: "officialReferenceAssetHead",
        description: "Metadata de l’image catalogue sans corps de réponse.",
        parameters: [
          parameter(
            "sourceId",
            "path",
            { type: "string", pattern: "^[\\w-]+$" },
            true,
          ),
          parameter("index", "path", { type: "integer", minimum: 0 }, true),
        ],
        responses: {
          "200": { description: "Image metadata" },
          "304": { description: "ETag unchanged" },
          "404": error,
          "413": error,
          "502": error,
        },
      },
    },
    "/media/capabilities": get("mediaCapabilities", {
      type: "object",
      description:
        "Présence et qualification séparées des API Bun.Video/FilmCraft. Remux MP4 limité aux configurations de pistes supportées ; HLS/transcodage désactivés si API absente.",
    }),
    "/anime/catalog/status": get("animeCatalogStatus", {
      type: "object",
      description:
        "Couverture des fiches et épisodes observés, source non officielle, lacunes et incohérences ; aucun média acquis par ce collecteur.",
    }),
    "/anime/works": get(
      "animeWorks",
      { type: "array", items: { type: "object" } },
      [
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
        }),
        parameter("offset", "query", { type: "integer", minimum: 0 }),
      ],
      { "400": error },
    ),
    "/anime/works/{workId}": get(
      "animeWork",
      {
        type: "object",
        description:
          "Fiche, épisodes paginés et relations observées. Saison fournisseur distincte de l’arc narratif.",
      },
      [
        parameter(
          "workId",
          "path",
          { type: "string", pattern: "^[a-f0-9]{24}$" },
          true,
        ),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
        }),
        parameter("offset", "query", { type: "integer", minimum: 0 }),
      ],
      { "400": error, "404": error },
    ),
    "/anime/arcs": get(
      "animeArcs",
      {
        type: "array",
        items: { type: "object" },
        description:
          "Arcs narratifs sourcés FR/EN/JA, plages originales et divergences conservées. Les plages de volumes manga ne sont pas des numéros d’épisodes.",
      },
      [
        parameter("lang", "query", {
          type: "string",
          enum: ["fr", "en", "ja"],
        }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
        }),
        parameter("offset", "query", { type: "integer", minimum: 0 }),
      ],
      { "400": error },
    ),
    "/streams": get(
      "streams",
      {
        type: "object",
        description:
          "Flux observés, pagination, provenance, expiration et accès. Les variantes watch/embed ne sont pas des vidéos distinctes.",
      },
      [
        parameter("provider", "query", str),
        parameter("kind", "query", {
          type: "string",
          enum: ["embed", "hls", "dash", "mp4", "watch", "catalogue"],
        }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 200,
        }),
        parameter("offset", "query", { type: "integer", minimum: 0 }),
      ],
      { "400": error },
    ),
    "/streams/{streamId}": get(
      "stream",
      {
        type: "object",
        description:
          "Source enregistrée et état réel ; aucune lecture distante présumée.",
      },
      [parameter("streamId", "path", int, true)],
      { "404": error },
    ),
    "/streams/{streamId}/play": {
      get: {
        operationId: "streamPlay",
        parameters: [parameter("streamId", "path", int, true)],
        responses: {
          "302": { description: "Redirection vers l’URL observée non expirée" },
          "404": error,
          "410": error,
        },
      },
    },
    "/streams/{streamId}/file": {
      get: {
        operationId: "streamCachedFile",
        parameters: [parameter("streamId", "path", int, true)],
        responses: {
          "200": {
            description: "MP4 en cache local, portée promotionnelle conservée",
            content: {
              "video/mp4": { schema: { type: "string", format: "binary" } },
            },
          },
          "206": { description: "Plage HTTP native" },
          "304": { description: "ETag inchangé" },
          "404": error,
        },
      },
    },
    "/streams/player": get("hlsPlayerStatus", {
      type: "object",
      description:
        "Disponibilité réelle du lecteur HLS installé avec Bun Video.",
    }),
    "/streams/player/{assetName}": {
      get: {
        operationId: "hlsPlayerAsset",
        parameters: [
          parameter(
            "assetName",
            "path",
            {
              type: "string",
              enum: ["hls.min.js", "hls.worker.js", "LICENSE"],
            },
            true,
          ),
        ],
        responses: {
          "200": { description: "Asset du propriétaire natif installé" },
          "304": { description: "ETag inchangé" },
          "404": error,
        },
      },
    },
    "/scenes": get(
      "scenes",
      array({
        type: "object",
        description:
          "Source réelle, textures WebP et contours SVG, plans/caméra 3D, reconstruction layered-2.5d.",
      }),
    ),
    "/scenes/status": get("sceneStatus", {
      type: "object",
      description:
        "Nombre de scènes préparées et disponibilité effective du SDK Koharu.",
    }),
    "/scenes/{sceneId}/manifest": get(
      "sceneManifest",
      {
        type: "object",
        description:
          "Manifest sourcé de plans en relief ; aucune reconstruction neuronale annoncée.",
      },
      [
        parameter(
          "sceneId",
          "path",
          { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" },
          true,
        ),
      ],
      { "404": error },
    ),
    "/scenes/{sceneId}/assets/{assetName}": {
      get: {
        operationId: "sceneAsset",
        parameters: [
          parameter("sceneId", "path", { type: "string" }, true),
          parameter(
            "assetName",
            "path",
            { type: "string", pattern: "^[a-zA-Z0-9_.-]+$" },
            true,
          ),
        ],
        responses: {
          "200": {
            description: "Asset de scène validé du cache, avec ETag.",
            content: {
              "image/webp": { schema: { type: "string", format: "binary" } },
              "image/svg+xml": { schema: { type: "string" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          "304": { description: "ETag inchangé" },
          "404": error,
          "400": error,
          "500": error,
        },
      },
    },
    "/health": get(
      "health",
      object({ ok: { const: true }, video: { type: "boolean" } }),
    ),
    "/stats": get("stats", ref("Stats")),
    "/library": get("libraryOverview", {
      type: "object",
      description:
        "Couverture locale manga/anime/wiki, sources et disponibilité des contenus réellement acquis.",
    }),
    "/manga/volumes/by-id/{volumeId}/pages": get(
      "mangaPagesByVolumeId",
      {
        type: "object",
        description:
          "Pages d’extrait par identifiant local, y compris les chapitres japonais sans ISBN. Cache lisible distinct des ressources reader_only.",
      },
      [
        parameter("volumeId", "path", { type: "integer", minimum: 1 }, true),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
        }),
        parameter("offset", "query", { type: "integer", minimum: 0 }),
      ],
      { "400": error },
    ),
    "/manga/volumes": get(
      "mangaVolumes",
      {
        type: "object",
        description:
          "Volumes éditoriaux et extraits : ISBN papier et EAN extrait distincts ; disponibilité et compte de pages.",
      },
      [
        parameter("q", "query", { type: "string", maxLength: 256 }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
        }),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          maximum: 1000000,
          default: 0,
        }),
      ],
      { "400": error },
    ),
    "/manga/volumes/{isbn}/pages": get(
      "mangaPages",
      {
        type: "object",
        description:
          "Pages dans l’ordre de lecture et assets du seul extrait EPUB acquis, avec provenance et liens CDN locaux.",
      },
      [
        parameter(
          "isbn",
          "path",
          { type: "string", pattern: "^[0-9]{13}$" },
          true,
        ),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
        }),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          maximum: 1000000,
          default: 0,
        }),
      ],
      { "400": error },
    ),
    "/anime": get(
      "animeLibrary",
      {
        type: "object",
        description:
          "Catalogue vidéo paginé ; distingue fichier local présent, fichier absent et métadonnées seules.",
      },
      [
        parameter("q", "query", { type: "string", maxLength: 256 }),
        parameter("provider", "query", {
          type: "string",
          enum: ["netflix", "youtube"],
        }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
        }),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          maximum: 1000000,
          default: 0,
        }),
      ],
      { "400": error },
    ),
    "/wiki": get(
      "wikiDocuments",
      {
        type: "object",
        description:
          "Documents wiki FR/EN/JA avec révisions et provenance ; recherche bornée explicitement à une fenêtre de 50 résultats.",
      },
      [
        parameter("q", "query", { type: "string", maxLength: 256 }),
        parameter("lang", "query", {
          type: "string",
          enum: ["fr", "en", "ja", "und"],
        }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
        }),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          maximum: 1000000,
          default: 0,
        }),
      ],
      { "400": error },
    ),
    "/wiki/{documentId}": get(
      "wikiDocument",
      {
        type: "object",
        description:
          "Fenêtre bornée du document original indexé, avec URL, langue et révision.",
      },
      [
        parameter("documentId", "path", { type: "integer", minimum: 1 }, true),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          maximum: 10000000,
          default: 0,
        }),
        parameter("maxCharacters", "query", {
          type: "integer",
          minimum: 1,
          maximum: 100000,
          default: 16000,
        }),
      ],
      { "400": error, "404": error },
    ),
    "/cdn/manga/{assetId}": {
      get: {
        operationId: "mangaImage",
        parameters: [
          parameter("assetId", "path", { type: "integer", minimum: 1 }, true),
        ],
        responses: {
          "200": {
            description: "Image manga validée du cache, type réel et ETag.",
            content: {
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
          "304": { description: "ETag inchangé" },
          "400": error,
          "404": error,
          "500": error,
        },
      },
    },
    "/cdn/manga/package/{isbn}.epub": {
      get: {
        operationId: "mangaPackage",
        parameters: [
          parameter(
            "isbn",
            "path",
            { type: "string", pattern: "^[0-9]{13}$" },
            true,
          ),
        ],
        responses: {
          "200": {
            description: "EPUB d’extrait acquis, aucun tome complet supposé.",
            content: {
              "application/epub+zip": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "206": { description: "Plage d’octets de l’EPUB acquis" },
          "304": { description: "ETag inchangé" },
          "400": error,
          "404": error,
          "416": { description: "Plage invalide" },
          "500": error,
        },
      },
    },
    "/index/status": get("indexStatus", ref("IndexStatus")),
    "/native/status": get("nativeStatus", {
      type: "object",
      description:
        "Capacités RAG Rust Aphrody, ABI Shenron et inventaire IA; inventaire distinct de disponibilité effective.",
    }),
    "/native/search": get(
      "nativeSearch",
      object({
        mode: { type: "string", enum: ["hybrid-lexical-hash", "lexical"] },
        ranking: { const: "aphrody-rag-core" },
        neuralEmbeddings: { const: false },
        hits: array(ref("SearchHit")),
      }),
      [
        parameter(
          "q",
          "query",
          { type: "string", minLength: 1, maxLength: 2000 },
          true,
        ),
        parameter("lang", "query", str),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        }),
      ],
      { "400": error },
    ),
    "/graphql/schema": {
      get: {
        operationId: "graphqlSchema",
        responses: {
          "200": {
            description: "SDL GraphQL du service de lecture",
            content: { "text/plain": { schema: str } },
          },
          "500": error,
        },
      },
    },
    "/search": get("search", array(ref("SearchHit")), [
      parameter(
        "q",
        "query",
        str,
        false,
        "Recherche FTS5 et titres flous ; texte normalisé limité à 256 caractères.",
      ),
      parameter(
        "lang",
        "query",
        str,
        false,
        "Filtre de langue, par exemple fr, en ou ja. Maximum de 10 résultats.",
      ),
    ]),
    "/index/search": get(
      "vectorSearch",
      array(ref("SearchHit")),
      [
        parameter("q", "query", str),
        parameter("lang", "query", str),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        }),
      ],
      {
        "400": error,
        "503": response(
          ref("IndexStatus"),
          "Index absent, périmé ou incompatible",
        ),
      },
    ),
    "/ask": get("ask", ref("Answer"), [
      parameter(
        "lang",
        "query",
        { type: "string", enum: ["fr", "en", "ja", "und"] },
        false,
        "Langue explicite ; sinon détection de la question.",
      ),
      parameter(
        "q",
        "query",
        { type: "string", minLength: 1, maxLength: 2000 },
        true,
        "Question extractive ; nécessite le pont CPython local.",
      ),
    ]),
    "/episodes": get("episodes", array(ref("Episode"))),
    "/episodes/{id}/frames": get(
      "frames",
      array(ref("Frame")),
      [
        id,
        parameter(
          "offset",
          "query",
          { type: "integer", minimum: 0, default: 0 },
          false,
          "Pagination par lots de 100 images.",
        ),
      ],
      { "400": error },
    ),
    "/episodes/{id}/video": {
      get: {
        operationId: "localEpisodeVideo",
        parameters: [id],
        responses: {
          "200": {
            description: "MP4 local indexé",
            content: {
              "video/mp4": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": error,
          "500": error,
        },
      },
    },
    "/episodes/{id}/frames/{number}.png": {
      get: {
        operationId: "localEpisodeFrame",
        parameters: [
          id,
          parameter("number", "path", { type: "integer", minimum: 0 }, true),
        ],
        responses: {
          "200": {
            description: "Image PNG locale indexée",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": error,
          "500": error,
        },
      },
    },
    "/catalog/videos": get(
      "mediaCatalog",
      object({
        sources: array(ref("MediaSource")),
        items: array(ref("MediaItem")),
      }),
    ),
    "/catalog/books": get("bookCatalog", array(ref("BookRecord"))),
    "/catalog/books/status": get(
      "bookCollectionStatus",
      object({
        books: int,
        withSynopsis: int,
        queue: array(object({ kind: str, state: str, count: int })),
      }),
    ),
    "/fancaps": get(
      "fancaps",
      ref("FancapsStatus"),
      [
        parameter("episode", "query", { type: "integer", minimum: 1 }),
        parameter("offset", "query", {
          type: "integer",
          minimum: 0,
          default: 0,
        }),
        parameter("limit", "query", {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 100,
        }),
      ],
      { "400": error },
    ),
    "/cdn/fancaps/{id}": {
      get: {
        operationId: "cachedFancapsImage",
        description:
          "Lecture du cache local uniquement. Aucun téléchargement réseau déclenché par cette requête.",
        parameters: [
          parameter("id", "path", { type: "integer", minimum: 1 }, true),
          { name: "If-None-Match", in: "header", schema: str },
        ],
        responses: {
          "200": {
            description: "Miniature en cache",
            headers: {
              ETag: { schema: str },
              "Cache-Control": { schema: str },
              "X-Content-Type-Options": { schema: { const: "nosniff" } },
            },
            content: {
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
          "304": { description: "Le cache du client correspond à ETag" },
          "404": { description: "Image absente du cache local" },
          "500": error,
        },
      },
    },
    "/openapi.json": get(
      "openapi",
      object(
        { openapi: str, info: { type: "object" }, paths: { type: "object" } },
        ["openapi", "info", "paths"],
      ),
    ),
    "/graphql": {
      get: {
        operationId: "graphqlGet",
        description:
          "GraphQL.js de référence : validation, fragments, directives, variables et introspection. Service Query de lecture, budgets de taille, profondeur et coût.",
        parameters: [
          parameter(
            "query",
            "query",
            { type: "string", maxLength: 32768 },
            true,
          ),
          parameter("variables", "query", str, false, "Objet JSON sérialisé"),
          parameter("operationName", "query", str),
        ],
        responses: {
          "200": response(ref("GraphQLResponse")),
          "400": response(ref("GraphQLResponse")),
          "500": response(ref("GraphQLResponse")),
        },
      },
      post: {
        operationId: "graphqlPost",
        description:
          "Une requête JSON, jusqu’à 128 Kio. Opérations Query uniquement.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: object(
                {
                  query: { type: "string", maxLength: 32768 },
                  variables: { type: ["object", "null"] },
                  operationName: nullable("string"),
                },
                ["query"],
              ),
            },
          },
        },
        responses: {
          "200": response(ref("GraphQLResponse")),
          "400": response(ref("GraphQLResponse")),
          "415": response(ref("GraphQLResponse")),
          "500": response(ref("GraphQLResponse")),
        },
      },
    },
  };
  const schemas: Record<string, Schema> = {
    Error: object({ error: str }),
    Stats: object({ documents: int, chunks: int, episodes: int, frames: int }),
    IndexStatus: object(
      {
        ready: { type: "boolean" },
        path: str,
        error: str,
        manifestPath: str,
        version: int,
        encoding: str,
        hashSignature: str,
        dimensions: int,
        metric: str,
        archiveId: str,
        revision: int,
        corpusDigest: str,
        indexDigest: str,
        chunks: int,
        entries: int,
        createdAt: str,
      },
      ["ready", "path"],
    ),
    SearchHit: object(
      {
        id: int,
        title: str,
        url: str,
        text: str,
        score: { type: "number" },
        language: str,
      },
      ["id", "title", "url", "text", "score"],
    ),
    Answer: object({
      answer: str,
      sources: array(object({ id: int, title: str, url: str })),
    }),
    Episode: object({
      id: str,
      metadata: {
        type: "string",
        description: "Métadonnées vidéo sérialisées en JSON",
      },
      next_frame: int,
      status: str,
    }),
    Frame: object({ number: int, time: { type: "number" }, hash: str }),
    MediaSource: object({
      provider: str,
      source_id: str,
      url: str,
      title: str,
      description: str,
      language: str,
      advertised_seasons: nullable("integer"),
      pending_continuation: int,
      provenance_json: str,
      fetched_at: str,
    }),
    MediaItem: object({
      provider: str,
      source_id: str,
      item_key: str,
      provider_id: nullable("string"),
      title: str,
      url: str,
      episode_number: nullable("integer"),
      season_number: nullable("integer"),
      duration_seconds: nullable("integer"),
      summary: str,
      audio_languages: {
        type: "string",
        description: "Tableau de langues sérialisé en JSON",
      },
      subtitle_languages: {
        type: "string",
        description: "Tableau de langues sérialisé en JSON",
      },
      episode_id: nullable("string"),
    }),
    BookRecord: object({
      url: str,
      title: str,
      authors_json: {
        type: "string",
        description: "Tableau des auteurs sérialisé en JSON",
      },
      isbn13: nullable("string"),
      published_on: nullable("string"),
      synopsis: nullable("string"),
      source_catalog_url: str,
      fetched_at: str,
      details_fetched_at: nullable("string"),
    }),
    GraphQLResponse: object(
      {
        data: { type: ["object", "null"] },
        errors: array(object({ message: str })),
      },
      [],
    ),
    FancapsStatus: object({
      series: object({ id: int, title: str, url: str }),
      counts: object({
        episodes: int,
        images: int,
        cachedImages: int,
        pendingPages: int,
        failedPages: int,
      }),
      pages: array(object({ state: str, n: int })),
      origins: array(object({ origin: str, kind: str, source_url: str })),
      episodes: array(
        object({
          id: int,
          number: nullable("integer"),
          title: str,
          url: str,
          source_url: str,
        }),
      ),
      images: array(
        object({
          id: int,
          episode_id: int,
          picture_url: str,
          thumbnail_url: str,
          full_url: { type: "null" },
          variant: { const: "thumbnail" },
          cdn_origin: str,
          source_page: str,
          cache_state: str,
          sha256: nullable("string"),
          mime: nullable("string"),
          bytes: nullable("integer"),
          width: nullable("integer"),
          height: nullable("integer"),
          local_url: nullable("string"),
        }),
      ),
    }),
  };
  return {
    openapi: "3.1.1",
    info: {
      title: "Fairy Tail Archive API",
      version: "0.1.0",
      description:
        "API locale Bun OS, SQLite, RAG extractif et catalogues sourcés. Les médias locaux et miniatures en cache restent distincts des catalogues publics.",
    },
    servers: [{ url: serverUrl }],
    paths,
    components: { schemas },
  };
}
export const openapiSpec = createOpenAPI;
