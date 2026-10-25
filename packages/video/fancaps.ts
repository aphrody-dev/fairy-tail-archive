import { mkdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { Archive } from "../archive/index.ts";
import { withCollectorLease } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";

export const FANCAPS_SERIES_URL =
  "https://fancaps.net/anime/showimages.php?7261-Fairy_Tail";
export const FANCAPS_CDN_ORIGINS = ["https://ant.fancaps.net"] as const;
const ROOT = resolve("data/fancaps");
const CACHE = resolve(ROOT, "cache");
type Episode = {
  id: number;
  number: number;
  title: string;
  url: string;
  source_url: string;
};
type Image = {
  id: number;
  episode_id: number;
  picture_url: string;
  thumbnail_url: string;
  full_url: null;
  variant: "thumbnail";
  cdn_origin: string;
  source_page: string;
};
type Page = {
  url: string;
  kind: "show" | "episode";
  episodeId: number | null;
  number: number | null;
  page: number;
};
type CachedImage = Image & {
  cache_state: string;
  sha256: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  cache_path: string | null;
};

export function canonicalFancapsPage(address: string): Page | null {
  try {
    const url = new URL(address, FANCAPS_SERIES_URL);
    if (
      url.origin !== "https://fancaps.net" ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    const parts = url.search.slice(1).split("&");
    if (parts.length > 2) return null;
    const pagination = parts[1];
    if (pagination && !/^page=[1-9]\d{0,3}$/.test(pagination)) return null;
    const page = pagination ? Number(pagination.slice(5)) : 1;
    if (
      url.pathname === "/anime/showimages.php" &&
      parts[0] === "7261-Fairy_Tail"
    )
      return {
        url: `${FANCAPS_SERIES_URL}${page === 1 ? "" : `&page=${page}`}`,
        kind: "show",
        episodeId: null,
        number: null,
        page,
      };
    const episode = /^([1-9]\d{0,8})-Fairy_Tail\/Episode_([1-9]\d{0,3})$/.exec(
      parts[0] ?? "",
    );
    if (url.pathname !== "/anime/episodeimages.php" || !episode) return null;
    return {
      url: `https://fancaps.net/anime/episodeimages.php?${parts[0]}${page === 1 ? "" : `&page=${page}`}`,
      kind: "episode",
      episodeId: Number(episode[1]),
      number: Number(episode[2]),
      page,
    };
  } catch {
    return null;
  }
}

function decodeLink(value: string): string {
  return value.replaceAll("&amp;", "&");
}
export function parseFancapsPage(address: string, body: string) {
  const page = canonicalFancapsPage(address);
  if (!page) throw new Error("Page hors du périmètre Fancaps Fairy Tail 7261");
  const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
  if (!title.includes("Fairy Tail"))
    throw new Error("Page Fancaps hors sujet ou challenge");
  if (
    page.kind === "episode" &&
    (!body.includes(FANCAPS_SERIES_URL) ||
      !new RegExp(
        `^# Images From Fairy Tail Episode ${page.number}\\s*$`,
        "m",
      ).test(body))
  )
    throw new Error("Épisode non rattaché à Fairy Tail 7261");
  const episodes = new Map<number, Episode>(),
    images = new Map<number, Image>();
  const pagination: Page[] = [];
  for (const match of body.matchAll(/\]\(([^\s)]+)\)/g)) {
    const found = canonicalFancapsPage(decodeLink(match[1]!));
    if (!found) continue;
    if (page.kind === "show" && found.kind === "episode" && found.page === 1)
      episodes.set(found.episodeId!, {
        id: found.episodeId!,
        number: found.number!,
        title: `Fairy Tail — Episode ${found.number}`,
        url: found.url,
        source_url: page.url,
      });
    if (
      found.kind === page.kind &&
      found.episodeId === page.episodeId &&
      found.page === page.page + 1
    )
      pagination.push(found);
  }
  if (page.kind === "episode") {
    for (const match of body.matchAll(
      /\[!\[Fairy Tail Image\]\((https:\/\/ant\.fancaps\.net\/([1-9]\d{0,12})\.jpg)\)\]\((https:\/\/fancaps\.net\/anime\/picture\.php\?\/([1-9]\d{0,12}))\)/g,
    )) {
      const id = Number(match[2]);
      if (match[2] !== match[4] || !Number.isSafeInteger(id)) continue;
      images.set(id, {
        id,
        episode_id: page.episodeId!,
        picture_url: match[3]!,
        thumbnail_url: match[1]!,
        full_url: null,
        variant: "thumbnail",
        cdn_origin: "https://ant.fancaps.net",
        source_page: page.url,
      });
    }
    if (!images.size)
      throw new Error(
        "Aucune miniature Fairy Tail vérifiée sur la page d'épisode",
      );
  } else if (!episodes.size)
    throw new Error("Aucun épisode Fairy Tail sur la page de série");
  return {
    page,
    title,
    episodes: [...episodes.values()],
    images: [...images.values()],
    next: pagination[0] ?? null,
  };
}

export function initFancaps(archive: Archive): void {
  archive.db.run(`
    CREATE TABLE IF NOT EXISTS fancaps_episodes(id INTEGER PRIMARY KEY,number INTEGER NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL UNIQUE,source_url TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fancaps_pages(id INTEGER PRIMARY KEY,url TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,episode_id INTEGER,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,content_hash TEXT,raw_path TEXT,fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS fancaps_origins(origin TEXT PRIMARY KEY,kind TEXT NOT NULL,source_url TEXT NOT NULL,observed_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS fancaps_images(id INTEGER PRIMARY KEY,episode_id INTEGER NOT NULL REFERENCES fancaps_episodes(id),picture_url TEXT NOT NULL,thumbnail_url TEXT NOT NULL,full_url TEXT,variant TEXT NOT NULL,cdn_origin TEXT NOT NULL REFERENCES fancaps_origins(origin),source_page TEXT NOT NULL,cache_state TEXT NOT NULL DEFAULT 'pending',sha256 TEXT,mime TEXT,bytes INTEGER,width INTEGER,height INTEGER,cache_path TEXT,cache_error TEXT,cached_at TEXT);
  `);
  archive.db
    .query("INSERT OR IGNORE INTO fancaps_pages(url,kind) VALUES(?,'show')")
    .run(FANCAPS_SERIES_URL);
}

export function storeFancapsPage(
  archive: Archive,
  address: string,
  body: string,
  rawPath: string | null = null,
) {
  initFancaps(archive);
  const parsed = parseFancapsPage(address, body);
  const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex");
  archive.db.transaction(() => {
    if (parsed.page.kind === "episode") {
      const known = archive.db
        .query<{ number: number }, [number]>(
          "SELECT number FROM fancaps_episodes WHERE id=?",
        )
        .get(parsed.page.episodeId!);
      if (!known || known.number !== parsed.page.number)
        throw new Error("Épisode absent du catalogue de série vérifié");
    }
    for (const episode of parsed.episodes) {
      archive.db
        .query(
          "INSERT INTO fancaps_episodes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,title=excluded.title,url=excluded.url,source_url=excluded.source_url",
        )
        .run(
          episode.id,
          episode.number,
          episode.title,
          episode.url,
          episode.source_url,
        );
      archive.db
        .query(
          "INSERT OR IGNORE INTO fancaps_pages(url,kind,episode_id) VALUES(?,'episode',?)",
        )
        .run(episode.url, episode.id);
    }
    for (const image of parsed.images) {
      archive.db
        .query(
          "INSERT OR IGNORE INTO fancaps_origins(origin,kind,source_url) VALUES(?,'thumbnail',?)",
        )
        .run(image.cdn_origin, image.source_page);
      archive.db
        .query(
          "INSERT INTO fancaps_images(id,episode_id,picture_url,thumbnail_url,full_url,variant,cdn_origin,source_page) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_page=excluded.source_page",
        )
        .run(
          image.id,
          image.episode_id,
          image.picture_url,
          image.thumbnail_url,
          null,
          "thumbnail",
          image.cdn_origin,
          image.source_page,
        );
    }
    if (parsed.next)
      archive.db
        .query(
          "INSERT OR IGNORE INTO fancaps_pages(url,kind,episode_id) VALUES(?,?,?)",
        )
        .run(parsed.next.url, parsed.next.kind, parsed.next.episodeId);
    archive.db
      .query(
        "INSERT INTO fancaps_pages(url,kind,episode_id,state,content_hash,raw_path,fetched_at) VALUES(?,?,?,'done',?,?,CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET state='done',last_error=NULL,content_hash=excluded.content_hash,raw_path=excluded.raw_path,fetched_at=CURRENT_TIMESTAMP",
      )
      .run(
        parsed.page.url,
        parsed.page.kind,
        parsed.page.episodeId,
        hash,
        rawPath,
      );
  })();
  archive.ingest(
    parsed.page.url,
    parsed.title,
    [
      parsed.title,
      ...parsed.episodes.map((e) => `${e.title} ${e.url}`),
      ...parsed.images.map(
        (i) =>
          `Fairy Tail Episode ${parsed.page.number} screencap ${i.id} ${i.picture_url}`,
      ),
    ].join("\n"),
    "en",
  );
  return {
    episodes: parsed.episodes.length,
    images: parsed.images.length,
    next: parsed.next?.url ?? null,
  };
}

function positiveId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identifiant Fancaps invalide");
}
function thumbnailAllowed(id: number, address: string): boolean {
  try {
    const u = new URL(address);
    return (
      u.origin === FANCAPS_CDN_ORIGINS[0] &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === `/${id}.jpg`
    );
  } catch {
    return false;
  }
}
function cachePathSafe(path: string): string {
  const root = realpathSync(CACHE),
    candidate = realpathSync(path),
    suffix = relative(root, candidate);
  if (
    !suffix ||
    suffix === ".." ||
    suffix.startsWith("../") ||
    suffix.startsWith("..\\") ||
    isAbsolute(suffix)
  )
    throw new Error("Chemin cache Fancaps invalide");
  return candidate;
}

export async function cacheFancapsImage(archive: Archive, id: number) {
  return withCollectorLease(archive, `fancaps:image:${id}`, (assertOwner) =>
    cacheFancapsImageOwned(archive, id, assertOwner),
  );
}
async function cacheFancapsImageOwned(
  archive: Archive,
  id: number,
  assertOwner: () => void,
) {
  positiveId(id);
  initFancaps(archive);
  const image = archive.db
    .query<CachedImage, [number]>("SELECT * FROM fancaps_images WHERE id=?")
    .get(id);
  if (!image) throw new Error("Image absente du catalogue Fairy Tail vérifié");
  if (
    !thumbnailAllowed(id, image.thumbnail_url) ||
    image.variant !== "thumbnail"
  )
    throw new Error("CDN ou variante non autorisé");
  if (image.cache_state === "cached" && image.cache_path) {
    try {
      const path = cachePathSafe(image.cache_path);
      if (Bun.file(path).size === image.bytes)
        return { ...image, local_url: `/cdn/fancaps/${id}` };
    } catch {
      /* repair a missing local cache */
    }
  }
  mkdirSync(CACHE, { recursive: true });
  const mirror = resolve(ROOT, "mirror", String(id), crypto.randomUUID());
  mkdirSync(mirror, { recursive: true });
  try {
    // Native mirror preserves binary response bytes; web fetch's JSON body is text.
    const result = (await aphrodyWeb(
      [
        "mirror",
        image.thumbnail_url,
        mirror,
        "--max-pages",
        "1",
        "--max-assets",
        "0",
        "--concurrency",
        "1",
        "--resolve-cdns",
        "false",
        "--json",
      ],
      45000,
    )) as { assetsWritten?: number; files?: string[]; failures?: unknown[] };
    assertOwner();
    const expected = `ant.fancaps.net/${id}.jpg`;
    if (
      result.assetsWritten !== 1 ||
      !result.files?.includes(expected) ||
      result.failures?.length
    )
      throw new Error("Miroir natif incomplet pour cette image");
    const file = Bun.file(resolve(mirror, expected));
    if (file.size < 1 || file.size > 8 * 1024 * 1024)
      throw new Error("Image hors de la borne 1 octet–8 Mio");
    const bytes = await file.bytes();
    const metadata = await new Bun.Image(resolve(mirror, expected)).metadata();
    const formats: Record<string, { extension: string; mime: string }> = {
      jpeg: { extension: "jpg", mime: "image/jpeg" },
      jpg: { extension: "jpg", mime: "image/jpeg" },
      png: { extension: "png", mime: "image/png" },
      webp: { extension: "webp", mime: "image/webp" },
    };
    const format = formats[metadata.format];
    if (
      !format ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width * metadata.height > 40000000
    )
      throw new Error("Format ou dimensions d'image refusés");
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const path = resolve(CACHE, `${hash}.${format.extension}`);
    await Bun.write(path, bytes);
    assertOwner();
    archive.db
      .query(
        "UPDATE fancaps_images SET cache_state='cached',sha256=?,mime=?,bytes=?,width=?,height=?,cache_path=?,cache_error=NULL,cached_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(
        hash,
        format.mime,
        bytes.byteLength,
        metadata.width,
        metadata.height,
        path,
        id,
      );
    return {
      id,
      variant: "thumbnail",
      sha256: hash,
      mime: format.mime,
      bytes: bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      source: image.thumbnail_url,
      local_url: `/cdn/fancaps/${id}`,
    };
  } catch (error) {
    assertOwner();
    archive.db
      .query(
        "UPDATE fancaps_images SET cache_state='failed',cache_error=? WHERE id=?",
      )
      .run(String(error), id);
    throw error;
  }
}

export function fancapsImageResponse(
  archive: Archive,
  id: number,
  headers?: Headers,
): Response {
  if (!Number.isSafeInteger(id) || id < 1)
    return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  initFancaps(archive);
  const image = archive.db
    .query<CachedImage, [number]>(
      "SELECT * FROM fancaps_images WHERE id=? AND cache_state='cached'",
    )
    .get(id);
  if (!image?.cache_path || !image.sha256 || !image.mime)
    return Response.json(
      { error: "Image non présente dans le cache local" },
      { status: 404 },
    );
  try {
    const path = cachePathSafe(image.cache_path),
      file = Bun.file(path);
    if (file.size !== image.bytes)
      return Response.json({ error: "Cache local incomplet" }, { status: 404 });
    const etag = `"${image.sha256}"`;
    const responseHeaders = {
      "Content-Type": image.mime,
      ETag: etag,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    };
    if (
      headers
        ?.get("if-none-match")
        ?.split(",")
        .map((v) => v.trim())
        .some((v) => v === etag || v === `W/${etag}` || v === "*")
    )
      return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(file, {
      headers: { ...responseHeaders, "Content-Length": String(image.bytes) },
    });
  } catch {
    return Response.json(
      { error: "Cache local inaccessible" },
      { status: 404 },
    );
  }
}

export function fancapsStatus(
  archive: Archive,
  options: { episodeId?: number; offset?: number; limit?: number } = {},
) {
  initFancaps(archive);
  const offset = options.offset ?? 0,
    limit = options.limit ?? 50;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error("Pagination Fancaps invalide");
  if (options.episodeId !== undefined) positiveId(options.episodeId);
  const count = (sql: string) =>
    archive.db.query<{ n: number }, []>(sql).get()!.n;
  const images = archive.db
    .query<CachedImage, [number | null, number | null, number, number]>(
      "SELECT * FROM fancaps_images WHERE (? IS NULL OR episode_id=?) ORDER BY episode_id,id LIMIT ? OFFSET ?",
    )
    .all(options.episodeId ?? null, options.episodeId ?? null, limit, offset)
    .map(({ cache_path: _cachePath, ...image }) => ({
      ...image,
      local_url:
        image.cache_state === "cached" ? `/cdn/fancaps/${image.id}` : null,
    }));
  return {
    series: { id: 7261, title: "Fairy Tail", url: FANCAPS_SERIES_URL },
    counts: {
      episodes: count("SELECT count(*) n FROM fancaps_episodes"),
      images: count("SELECT count(*) n FROM fancaps_images"),
      cachedImages: count(
        "SELECT count(*) n FROM fancaps_images WHERE cache_state='cached'",
      ),
      pendingPages: count(
        "SELECT count(*) n FROM fancaps_pages WHERE state='pending'",
      ),
      failedPages: count(
        "SELECT count(*) n FROM fancaps_pages WHERE state='failed'",
      ),
    },
    pages: archive.db
      .query("SELECT state,count(*) n FROM fancaps_pages GROUP BY state")
      .all(),
    origins: archive.db
      .query(
        "SELECT origin,kind,source_url FROM fancaps_origins ORDER BY origin",
      )
      .all(),
    episodes: archive.db
      .query("SELECT * FROM fancaps_episodes ORDER BY number LIMIT ? OFFSET ?")
      .all(limit, offset),
    images,
  };
}

export async function collectFancaps(
  archive: Archive,
  options: Parameters<typeof collectFancapsOwned>[1] = {},
) {
  return withCollectorLease(archive, "fancaps:7261", (assertOwner) =>
    collectFancapsOwned(archive, options, assertOwner),
  );
}

async function collectFancapsOwned(
  archive: Archive,
  options: {
    maxPages?: number;
    cacheImages?: number;
    retryFailed?: boolean;
    signal?: AbortSignal;
  } = {},
  assertOwner: () => void = () => {},
) {
  initFancaps(archive);
  const budget = options.maxPages ?? 10,
    cacheBudget = options.cacheImages ?? 0;
  if (
    !Number.isSafeInteger(budget) ||
    budget < 1 ||
    budget > 10000 ||
    !Number.isSafeInteger(cacheBudget) ||
    cacheBudget < 0 ||
    cacheBudget > 1000
  )
    throw new Error("Budgets Fancaps invalides");
  if (options.retryFailed)
    archive.db.run(
      "UPDATE fancaps_pages SET state='pending' WHERE state='failed'; UPDATE fancaps_images SET cache_state='pending' WHERE cache_state='failed';",
    );
  // Recover interrupted pages only while holding the cross-process series lease.
  archive.db.run(
    "UPDATE fancaps_pages SET state='pending' WHERE state='running'",
  );
  const errors: { url: string; error: string }[] = [];
  let processedPages = 0,
    cachedImages = 0;
  mkdirSync(resolve(ROOT, "pages"), { recursive: true });
  for (let i = 0; i < budget; i++) {
    assertOwner();
    options.signal?.throwIfAborted();
    const page = archive.db
      .query<{ url: string }, []>(
        "SELECT url FROM fancaps_pages WHERE state='pending' ORDER BY id LIMIT 1",
      )
      .get();
    if (!page) break;
    const canonical = canonicalFancapsPage(page.url);
    if (!canonical) throw new Error("File Fancaps hors périmètre");
    archive.db
      .query(
        "UPDATE fancaps_pages SET state='running',attempts=attempts+1 WHERE url=?",
      )
      .run(page.url);
    try {
      const result = (await aphrodyWeb(
        ["fetch", page.url, "--json"],
        45000,
      )) as {
        body?: string;
        transport?: { status?: number; final_url?: string };
        truncated?: boolean;
      };
      assertOwner();
      if (
        typeof result.body !== "string" ||
        result.truncated ||
        result.transport?.status !== 200 ||
        canonicalFancapsPage(result.transport.final_url ?? page.url)?.url !==
          canonical.url
      )
        throw new Error(
          "Réponse Fancaps invalide, tronquée ou redirigée hors périmètre",
        );
      const raw = resolve(
        ROOT,
        "pages",
        `${new Bun.CryptoHasher("sha256").update(page.url).digest("hex")}.json`,
      );
      const staged = `${raw}.${crypto.randomUUID()}.tmp`;
      try {
        await Bun.write(staged, JSON.stringify(result));
        archive.db.transaction(() => {
          assertOwner();
          renameSync(staged, raw);
          storeFancapsPage(archive, page.url, result.body!, raw);
        })();
      } finally {
        try {
          unlinkSync(staged);
        } catch {
          /* Published or write failed. */
        }
      }
      processedPages++;
    } catch (error) {
      assertOwner();
      archive.db
        .query(
          "UPDATE fancaps_pages SET state='failed',last_error=? WHERE url=?",
        )
        .run(String(error), page.url);
      errors.push({ url: page.url, error: String(error) });
    }
    if (i + 1 < budget) await Bun.sleep(1000);
  }
  const pending = archive.db
    .query<{ id: number }, [number]>(
      "SELECT id FROM fancaps_images WHERE cache_state='pending' ORDER BY episode_id,id LIMIT ?",
    )
    .all(cacheBudget);
  for (const image of pending) {
    assertOwner();
    options.signal?.throwIfAborted();
    try {
      await cacheFancapsImage(archive, image.id);
      cachedImages++;
    } catch (error) {
      errors.push({ url: `fancaps-image:${image.id}`, error: String(error) });
    }
    if (cacheBudget > 1) await Bun.sleep(1000);
  }
  const report = {
    processedPages,
    cachedImages,
    errors,
    status: fancapsStatus(archive),
    exhaustive: false,
  };
  await Bun.write(
    resolve(ROOT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}
