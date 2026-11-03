import { Archive } from "../../packages/archive/index.ts";
import { referenceAssetResponse } from "../../packages/official-sources/asset-response.ts";
import { lucyReferences } from "../../packages/official-sources/lucy.ts";
import {
  animeCatalogStatus,
  listAnimeWorks,
  getAnimeWork,
} from "../../packages/anime-catalog/index.ts";
import { listAnimeArcs } from "../../packages/anime-catalog/arcs.ts";
import { mediaCapabilities } from "../../packages/video/capabilities.ts";
import { streamFileResponse } from "../../packages/streams/import.ts";
import { mediaCatalog } from "../../packages/video/sources.ts";
import { publisherStatus } from "../../packages/crawler/publisher.ts";
import { createOpenAPI } from "../../packages/api-contract/openapi.ts";
import {
  handleGraphQL,
  schemaSDL,
} from "../../packages/api-contract/graphql.ts";
import { indexStatus, searchIndex } from "../../packages/search-index/index.ts";
import {
  nativeStatus,
  hybridSearch,
  cancelNativeCalls,
} from "../../packages/native-ai/index.ts";
import {
  sceneCatalog,
  sceneAssetResponse,
} from "../../packages/scene/index.ts";
import { koharuStatus } from "../../packages/scene/koharu.ts";
import {
  streamCatalog,
  findStream,
  getHlsPlayerAssets,
  hlsPlayerAssetResponse,
  parseStreamKind,
} from "../../packages/streams/index.ts";
import { resolve } from "node:path";
import { contained } from "../../packages/video/index.ts";
import {
  libraryOverview,
  listMangaVolumes,
  animeCatalog,
  wikiDocuments,
  getWikiDocument,
  readMangaPreview,
} from "../../packages/library/index.ts";
import {
  fancapsStatus,
  fancapsImageResponse,
} from "../../packages/video/fancaps.ts";

const states = new WeakMap<
  Bun.Server,
  { stopping: boolean; heavy: number; tokens: number; refillAt: number }
>();
function secureResponse(
  response: Response,
  requestId: string,
  duration: number,
) {
  const apply = (headers: Headers) => {
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Request-ID", requestId);
    headers.set("Server-Timing", `app;dur=${duration.toFixed(1)}`);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' blob: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    apply(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
export function createServer(archive: Archive, port = 3000) {
  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    try {
      const reference = await referenceAssetResponse(req);
      if (reference) return reference;
      if (url.pathname === "/graphql") return await handleGraphQL(archive, req);
      if (req.method !== "GET")
        return Response.json(
          { error: "Méthode non autorisée" },
          { status: 405 },
        );
      if (url.pathname === "/health")
        return Response.json({ ok: true, video: Bun.Video.available });
      if (url.pathname === "/characters/lucy/references")
        return Response.json(lucyReferences());
      if (url.pathname === "/media/capabilities")
        return Response.json(mediaCapabilities());
      if (url.pathname === "/anime/catalog/status")
        return Response.json(animeCatalogStatus(archive));
      if (
        url.pathname === "/anime/works" ||
        url.pathname === "/anime/arcs" ||
        /^\/anime\/works\/[a-f0-9]{24}$/.test(url.pathname)
      ) {
        try {
          const pagination = {
            limit: Number(url.searchParams.get("limit") ?? 20),
            offset: Number(url.searchParams.get("offset") ?? 0),
          };
          if (url.pathname === "/anime/arcs")
            return Response.json(
              listAnimeArcs(archive, {
                ...pagination,
                lang: url.searchParams.get("lang") ?? undefined,
              }),
            );
          if (url.pathname === "/anime/works")
            return Response.json(listAnimeWorks(archive, pagination));
          const work = getAnimeWork(
            archive,
            url.pathname.split("/").at(-1)!,
            pagination,
          );
          return work
            ? Response.json(work)
            : Response.json({ error: "Catalogue absent" }, { status: 404 });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      }
      if (url.pathname === "/streams/player")
        return Response.json(await getHlsPlayerAssets());
      const hlsAsset =
        /^\/streams\/player\/(hls\.min\.js|hls\.worker\.js|LICENSE)$/.exec(
          url.pathname,
        );
      if (hlsAsset)
        return await hlsPlayerAssetResponse(hlsAsset[1]!, req.headers);
      if (url.pathname === "/streams") {
        try {
          return Response.json(
            streamCatalog(archive, {
              provider: url.searchParams.get("provider") ?? undefined,
              kind: parseStreamKind(url.searchParams.get("kind")),
              limit: Number(url.searchParams.get("limit") ?? 50),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }),
          );
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 400 });
        }
      }
      const streamFile = /^\/streams\/([1-9][0-9]*)\/file$/.exec(url.pathname);
      if (streamFile)
        return await streamFileResponse(
          archive,
          Number(streamFile[1]),
          req.headers,
        );
      const stream = /^\/streams\/([0-9]+)(\/play)?$/.exec(url.pathname);
      if (stream) {
        const row = findStream(archive, Number(stream[1]));
        if (!row)
          return Response.json(
            { error: "Stream not catalogued" },
            { status: 404 },
          );
        if (stream[2]) {
          if (row.expired)
            return Response.json(
              { error: "Stream link expired; refresh the catalogue" },
              { status: 410 },
            );
          return Response.redirect(row.url, 302);
        }
        return Response.json(row);
      }
      if (url.pathname === "/") {
        const home = Bun.file(
          resolve(import.meta.dir, "../../target/home/index.html"),
        );
        if (await home.exists())
          return new Response(home, {
            headers: { "Cache-Control": "no-store" },
          });
      }
      if (url.pathname.startsWith("/home/")) {
        const name = url.pathname.slice(6),
          root = resolve(import.meta.dir, "../../target/home");
        if (
          !/^[A-Za-z0-9_./-]+$/.test(name) ||
          name.split("/").some((part) => part === ".." || part === "")
        )
          return new Response("Not found", { status: 404 });
        try {
          return new Response(Bun.file(contained(root, resolve(root, name))), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
      if (url.pathname === "/scenes")
        return Response.json(sceneCatalog(archive));
      if (url.pathname === "/scenes/status")
        return Response.json({
          scenes: sceneCatalog(archive).length,
          koharu: await koharuStatus(),
        });
      const sceneManifest = /^\/scenes\/([a-zA-Z0-9_-]{1,80})\/manifest$/.exec(
        url.pathname,
      );
      if (sceneManifest) {
        const scene = sceneCatalog(archive).find(
          (s) => s.id === sceneManifest[1],
        );
        return scene
          ? Response.json(scene)
          : Response.json({ error: "Scene not prepared" }, { status: 404 });
      }
      const sceneAsset =
        /^\/scenes\/([a-zA-Z0-9_-]{1,80})\/assets\/([a-zA-Z0-9_.-]+)$/.exec(
          url.pathname,
        );
      if (sceneAsset)
        return sceneAssetResponse(
          archive,
          sceneAsset[1]!,
          sceneAsset[2]!,
          req.headers,
        );
      if (url.pathname === "/library")
        return Response.json(libraryOverview(archive));
      if (
        ["/manga/volumes", "/anime", "/wiki"].includes(url.pathname) ||
        /^\/wiki\/[0-9]+$/.test(url.pathname) ||
        /^\/manga\/volumes\/(?:by-id\/)?[0-9]+\/pages$/.test(url.pathname)
      ) {
        try {
          const options = {
            q: url.searchParams.get("q") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 20),
            offset: Number(url.searchParams.get("offset") ?? 0),
          };
          if (url.pathname === "/manga/volumes")
            return Response.json(listMangaVolumes(archive, options));
          if (url.pathname === "/anime")
            return Response.json(
              await animeCatalog(archive, {
                ...options,
                provider: url.searchParams.get("provider") ?? undefined,
              }),
            );
          if (url.pathname === "/wiki")
            return Response.json(
              wikiDocuments(archive, {
                ...options,
                lang: url.searchParams.get("lang") ?? undefined,
              }),
            );
          const wiki = /^\/wiki\/([0-9]+)$/.exec(url.pathname);
          if (wiki) {
            const doc = getWikiDocument(archive, Number(wiki[1]), {
              offset: options.offset,
              maxCharacters: Number(
                url.searchParams.get("maxCharacters") ?? 16000,
              ),
            });
            return doc
              ? Response.json(doc)
              : Response.json(
                  { error: "Wiki document not indexed" },
                  { status: 404 },
                );
          }
          const manga = /^\/manga\/volumes\/(by-id\/)?([0-9]+)\/pages$/.exec(
            url.pathname,
          )!;
          return Response.json(
            readMangaPreview(archive, manga[1] ? Number(manga[2]) : manga[2]!, {
              limit: options.limit,
              offset: options.offset,
            }),
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      }
      const mangaImage = /^\/cdn\/manga\/([0-9]+)$/.exec(url.pathname);
      if (mangaImage)
        return (
          await import("../../packages/manga/index.ts")
        ).mangaImageResponse(archive, Number(mangaImage[1]), req.headers);
      const mangaPackage = /^\/cdn\/manga\/package\/([0-9]{13})\.epub$/.exec(
        url.pathname,
      );
      if (mangaPackage)
        return (
          await import("../../packages/manga/index.ts")
        ).mangaPackageResponse(archive, mangaPackage[1]!, req.headers);
      if (url.pathname === "/openapi.json")
        return Response.json(createOpenAPI(url.origin));
      if (url.pathname === "/graphql/schema")
        return new Response(schemaSDL, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      if (url.pathname === "/index/status")
        return Response.json(await indexStatus(archive));
      if (url.pathname === "/native/status")
        return Response.json(await nativeStatus());
      if (url.pathname === "/native/search") {
        const q = url.searchParams.get("q") ?? "",
          limit = Number(url.searchParams.get("limit") ?? 10);
        if (
          !q.trim() ||
          q.length > 2000 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          return Response.json(
            { error: "q required, limit 1..50" },
            { status: 400 },
          );
        return Response.json(
          await hybridSearch(archive, q, {
            limit,
            lang: url.searchParams.get("lang") ?? undefined,
          }),
        );
      }
      if (url.pathname === "/index/search") {
        const q = url.searchParams.get("q") ?? "",
          limit = Number(url.searchParams.get("limit") ?? 10);
        if (
          !q.trim() ||
          q.length > 2000 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          return Response.json(
            { error: "q requis (2000 caractères maximum), limit de 1 à 50" },
            { status: 400 },
          );
        const status = await indexStatus(archive);
        if (!status.ready) return Response.json(status, { status: 503 });
        return Response.json(
          await searchIndex(archive, q, {
            limit,
            lang: url.searchParams.get("lang") ?? undefined,
          }),
        );
      }
      if (url.pathname === "/stats") return Response.json(archive.stats());
      if (url.pathname === "/catalog/videos")
        return Response.json(mediaCatalog(archive));
      if (url.pathname === "/catalog/books/status")
        return Response.json(publisherStatus(archive));
      if (url.pathname === "/fancaps") {
        const offset = Number(url.searchParams.get("offset") ?? 0),
          limit = Number(url.searchParams.get("limit") ?? 100),
          episode = url.searchParams.get("episode");
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 200 ||
          (episode !== null &&
            (!Number.isSafeInteger(Number(episode)) || Number(episode) < 1))
        )
          return Response.json(
            { error: "Pagination ou épisode invalide" },
            { status: 400 },
          );
        return Response.json(
          fancapsStatus(archive, {
            offset,
            limit,
            episodeId: episode === null ? undefined : Number(episode),
          }),
        );
      }
      const cdn = /^\/cdn\/fancaps\/([0-9]+)$/.exec(url.pathname);
      if (cdn)
        return fancapsImageResponse(archive, Number(cdn[1]), req.headers);
      if (url.pathname === "/catalog/books") {
        if (
          !archive.db
            .query("SELECT name FROM sqlite_master WHERE name='catalog_books'")
            .get()
        )
          return Response.json([]);
        return Response.json(
          archive.db.query("SELECT * FROM catalog_books").all(),
        );
      }
      if (url.pathname === "/search")
        return Response.json(
          archive.search(
            url.searchParams.get("q") ?? "",
            10,
            url.searchParams.get("lang") ?? undefined,
          ),
        );
      if (url.pathname === "/ask") {
        const question = url.searchParams.get("q") ?? "",
          language = url.searchParams.get("lang") ?? undefined;
        if (
          !question.trim() ||
          question.length > 2000 ||
          (language !== undefined &&
            !["fr", "en", "ja", "und"].includes(language))
        )
          return Response.json(
            {
              error:
                "Question requise (2000 caractères maximum), lang parmi fr/en/ja/und",
            },
            { status: 400 },
          );
        const { ask } = await import("../../packages/rag/index.ts");
        return Response.json(await ask(archive, question, language));
      }
      if (url.pathname === "/episodes")
        return Response.json(
          archive.db
            .query(
              "SELECT id,metadata,next_frame,status FROM episodes ORDER BY id",
            )
            .all(),
        );
      const asset =
        /^\/episodes\/([a-f0-9]{24})\/(video|frames\/([0-9]+)\.png)$/.exec(
          url.pathname,
        );
      if (asset) {
        const row =
          asset[2] === "video"
            ? archive.db
                .query<{ path: string }, [string]>(
                  "SELECT path FROM episodes WHERE id=?",
                )
                .get(asset[1]!)
            : archive.db
                .query<{ path: string }, [string, number]>(
                  "SELECT path FROM frames WHERE episode_id=? AND number=?",
                )
                .get(asset[1]!, Number(asset[3]));
        if (!row)
          return Response.json({ error: "Média absent" }, { status: 404 });
        return new Response(Bun.file(row.path), {
          headers: {
            "Content-Type": asset[2] === "video" ? "video/mp4" : "image/png",
          },
        });
      }
      const match = /^\/episodes\/([a-f0-9]{24})\/frames$/.exec(url.pathname);
      if (match) {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0)
          return Response.json({ error: "offset invalide" }, { status: 400 });
        return Response.json(
          archive.db
            .query(
              "SELECT number,time,hash FROM frames WHERE episode_id=? ORDER BY number LIMIT 100 OFFSET ?",
            )
            .all(match[1]!, offset),
        );
      }
      return Response.json(
        {
          routes: [
            "/health",
            "/library",
            "/scenes",
            "/scenes/:id/manifest",
            "/scenes/:id/assets/:assetName",
            "/scenes/status",
            "/manga/volumes",
            "/manga/volumes/:isbn/pages",
            "/cdn/manga/:assetId",
            "/cdn/manga/package/:isbn.epub",
            "/anime",
            "/anime/works",
            "/anime/works/:workId?limit=100&offset=0",
            "/anime/arcs?lang=fr",
            "/anime/catalog/status",
            "/media/capabilities",
            "/references/:sourceId/:index",
            "/characters/lucy/references",
            "/wiki",
            "/wiki/:id",
            "/openapi.json",
            "/graphql",
            "/graphql/schema",
            "/index/status",
            "/native/status",
            "/native/search?q=Natsu&lang=fr",
            "/index/search?q=Natsu",
            "/stats",
            "/catalog/videos",
            "/catalog/books",
            "/catalog/books/status",
            "/fancaps?offset=0&limit=100",
            "/cdn/fancaps/:id",
            "/search?q=Natsu",
            "/ask?q=Qui%20est%20Natsu",
            "/episodes",
            "/episodes/:id/frames?offset=0",
            "/episodes/:id/frames/:number.png",
            "/episodes/:id/video",
          ],
        },
        {
          status: url.pathname === "/" || url.pathname === "/api" ? 200 : 404,
        },
      );
    } catch (error) {
      console.error(error);
      return Response.json(
        { error: "Requête impossible; consulter les logs locaux" },
        { status: 500 },
      );
    }
  };
  const state = { stopping: false, heavy: 0, tokens: 12, refillAt: Date.now() };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const start = performance.now(),
        requestId = crypto.randomUUID(),
        url = new URL(request.url);
      if (state.stopping)
        return secureResponse(
          Response.json(
            { error: "Server shutting down" },
            { status: 503, headers: { "Retry-After": "1" } },
          ),
          requestId,
          performance.now() - start,
        );
      const heavy = [
        "/ask",
        "/native/search",
        "/native/status",
        "/index/search",
      ].includes(url.pathname);
      const now = Date.now();
      state.tokens = Math.min(12, state.tokens + (now - state.refillAt) / 1000);
      state.refillAt = now;
      if (heavy && (state.heavy >= 4 || state.tokens < 1))
        return secureResponse(
          Response.json(
            { error: "Request budget exceeded; retry shortly" },
            { status: 429, headers: { "Retry-After": "2" } },
          ),
          requestId,
          performance.now() - start,
        );
      if (heavy) {
        state.heavy++;
        state.tokens--;
      }
      try {
        // Preserve the original file response: Bun owns backpressure and HTTP byte ranges.
        const response = secureResponse(
          await handle(
            request.method === "HEAD"
              ? new Request(request.url, {
                  headers: request.headers,
                  method: "GET",
                  signal: request.signal,
                })
              : request,
          ),
          requestId,
          performance.now() - start,
        );
        if (request.method === "HEAD") {
          await response.body?.cancel().catch(() => {});
          return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
        return response;
      } finally {
        if (heavy) state.heavy--;
      }
    },
  });
  states.set(server, state);
  return server;
}
export async function stopServer(
  server: Bun.Server,
  archive: Archive,
  graceMs = 10000,
) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 60000)
    throw new Error("Invalid shutdown grace period");
  const state = states.get(server);
  if (state?.stopping) return;
  if (state) state.stopping = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      server.stop(false),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          void server.stop(true).then(resolve);
        }, graceMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await cancelNativeCalls();
    archive.close();
  }
}
if (import.meta.main) {
  const archive = new Archive();
  const server = createServer(archive, Number(Bun.env.PORT ?? 3000));
  console.log(`Fairy Tail Archive: ${server.url}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void stopServer(server, archive)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
