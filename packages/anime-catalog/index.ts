import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Archive, withCollectorLease } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";
import { robotsAllowed } from "../crawler/index.ts";

export const ANIME_CATALOG_URL = "https://voir-anime.to/anime/fairy-tail-vf/";
const ORIGIN = "https://voir-anime.to",
  MAX_BYTES = 4_000_000;
const hash = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const clean = (text: string) =>
  text
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|hellip);/gi,
      (entity: string, key: string) => {
        if (key.startsWith("#")) {
          const value =
            key[1]?.toLowerCase() === "x"
              ? Number.parseInt(key.slice(2), 16)
              : Number(key.slice(1));
          return value > 0 &&
            value <= 0x10ffff &&
            !(value >= 0xd800 && value <= 0xdfff)
            ? String.fromCodePoint(value)
            : entity;
        }
        return (
          (
            {
              amp: "&",
              quot: '"',
              apos: "'",
              lt: "<",
              gt: ">",
              nbsp: " ",
              ndash: "–",
              mdash: "—",
              hellip: "…",
            } as Record<string, string>
          )[key.toLowerCase()] ?? entity
        );
      },
    )
    .replace(/\s+/g, " ")
    .trim();
export function animeWorkUrl(
  input: string,
  base = ANIME_CATALOG_URL,
): string | null {
  try {
    const url = new URL(input, base);
    if (
      url.origin !== ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      !/^\/anime\/fairy-tail(?:-[a-z0-9]+)*\/$/.test(url.pathname)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function animeWorkId(url: string): string {
  const canonical = animeWorkUrl(url);
  if (!canonical) throw new Error("Catalogue Fairy Tail hors périmètre");
  return hash(canonical).slice(0, 24);
}
type Link = { url: string; title: string };
export type AnimeListing = {
  url: string;
  title: string;
  kind: string;
  language: string;
  metadata: Record<string, string>;
  advertisedEpisodes: number | null;
  episodes: (Link & { number: number | null; season: number | null })[];
  related: Link[];
  audit: {
    rawEpisodeLinks: number;
    uniqueEpisodeUrls: number;
    duplicateUrls: string[];
    duplicateNumbers: number[];
    missingNumbers: number[];
    outOfRangeNumbers: number[];
    countMismatch: boolean;
    unnumbered: number;
    numberingComplete: boolean;
    seasonMapping: "not-exposed";
    mediaAcquired: false;
    uncertainties: string[];
  };
};

/** HTMLRewriter parses inert markup: scripts, players and remote assets are never executed. */
export async function parseAnimeCatalogue(
  body: string,
  url: string,
): Promise<AnimeListing> {
  const canonical = animeWorkUrl(url);
  if (!canonical) throw new Error("Catalogue hors périmètre");
  if (new TextEncoder().encode(body).length > MAX_BYTES)
    throw new Error("Catalogue trop volumineux");
  const links: Link[] = [],
    metadata: Record<string, string> = {};
  let title = "",
    label = "",
    value = "";
  if (/^\s*</.test(body)) {
    type Element = { getAttribute(name: string): string | null };
    type Chunk = { text: string };
    type Rewriter = {
      on(
        selector: string,
        handler: {
          element?: (element: Element) => void;
          text?: (chunk: Chunk) => void;
        },
      ): Rewriter;
      transform(response: Response): Response;
    };
    const Native = (
      globalThis as unknown as { HTMLRewriter: new () => Rewriter }
    ).HTMLRewriter;
    await new Native()
      .on("h1", {
        text: (t) => {
          title += t.text;
        },
      })
      .on(".summary-heading h5", {
        element: () => {
          label = "";
        },
        text: (t) => {
          label += t.text;
        },
      })
      .on(".summary-content", {
        element: () => {
          value = "";
        },
        text: (t) => {
          value += t.text;
          metadata[clean(label)] = clean(value);
        },
      })
      .on("a[href]", {
        element: (e) => {
          links.push({ url: e.getAttribute("href") ?? "", title: "" });
        },
        text: (t) => {
          const link = links.at(-1);
          if (link) link.title += t.text;
        },
      })
      .transform(new Response(body))
      .text();
  } else {
    title = body.match(/^# (.+)$/m)?.[1] ?? "";
    for (const match of body.matchAll(/^##### ([^\n]+)\n+([^\n]+)/gm))
      metadata[clean(match[1]!)] = clean(match[2]!);
    for (const match of body.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g))
      links.push({ title: match[1]!, url: match[2]! });
  }
  title = clean(title);
  if (!/fairy\s*tail/i.test(title))
    throw new Error("Titre Fairy Tail non observé");
  const related = new Map<string, Link>(),
    episodes = new Map<
      string,
      Link & { number: number | null; season: null }
    >(),
    raw: Link[] = [];
  const duplicates = new Set<string>();
  for (const link of links) {
    let address: URL;
    try {
      address = new URL(link.url, canonical);
    } catch {
      continue;
    }
    address.hash = "";
    if (
      address.origin !== ORIGIN ||
      address.search ||
      address.username ||
      address.password
    )
      continue;
    const work = animeWorkUrl(address.href);
    if (work && work !== canonical)
      related.set(work, { url: work, title: clean(link.title) });
    if (
      !address.pathname.startsWith(new URL(canonical).pathname) ||
      address.href === canonical ||
      !/^\/anime\/[^/]+\/[^/]+\/$/.test(address.pathname)
    )
      continue;
    const text = clean(link.title);
    if (!/fairy\s*tail/i.test(text)) continue;
    raw.push({ url: address.href, title: text });
    if (episodes.has(address.href)) {
      duplicates.add(address.href);
      continue;
    }
    const n =
      text.match(
        /(?:^|\s[-–:]\s|\b(?:episode|épisode|ep)\s*)(\d{1,4})(?:\s|$)/i,
      )?.[1] ??
      address.pathname.match(/-(\d{1,4})(?:-(?:vf|vostfr))?\/$/i)?.[1];
    episodes.set(address.href, {
      url: address.href,
      title: text,
      number: n ? Number(n) : null,
      season: null,
    });
  }
  const numbers = new Map<number, number>();
  for (const episode of episodes.values())
    if (episode.number !== null)
      numbers.set(episode.number, (numbers.get(episode.number) ?? 0) + 1);
  const count = /^\d{1,4}$/.test(metadata.Episodes ?? "")
    ? Number(metadata.Episodes)
    : null;
  const end = numbers.size ? (count ?? Math.max(0, ...numbers.keys())) : 0;
  const missing: number[] = [];
  for (let i = 1; i <= end; i++) if (!numbers.has(i)) missing.push(i);
  const duplicateNumbers = [...numbers]
    .filter(([, n]) => n > 1)
    .map(([n]) => n);
  const type = (metadata.Type ?? "").toLowerCase();
  const kind = /movie|film/.test(type)
    ? "film"
    : /ova|oav/.test(type)
      ? "ova"
      : /special/.test(type)
        ? "special"
        : /tv/.test(type)
          ? "series"
          : "unknown";
  const language = /\bVF\b/i.test(title)
    ? "fr"
    : /VOSTFR/i.test(
          title +
            " " +
            [...episodes.values()]
              .slice(0, 3)
              .map((e) => e.title)
              .join(" "),
        )
      ? "ja-sub-fr"
      : "unknown";
  const unnumbered = [...episodes.values()].filter(
    (e) => e.number === null,
  ).length;
  return {
    url: canonical,
    title,
    kind,
    language,
    metadata,
    advertisedEpisodes: count,
    episodes: [...episodes.values()].sort(
      (a, b) =>
        (a.number ?? Infinity) - (b.number ?? Infinity) ||
        a.url.localeCompare(b.url),
    ),
    related: [...related.values()],
    audit: {
      rawEpisodeLinks: raw.length,
      uniqueEpisodeUrls: episodes.size,
      duplicateUrls: [...duplicates],
      duplicateNumbers,
      missingNumbers: missing,
      outOfRangeNumbers:
        count === null
          ? []
          : [...numbers.keys()].filter((n) => n < 1 || n > count),
      countMismatch: count !== null && episodes.size !== count,
      unnumbered,
      numberingComplete:
        count !== null &&
        episodes.size === count &&
        !missing.length &&
        !duplicateNumbers.length &&
        !unnumbered,
      seasonMapping: "not-exposed",
      mediaAcquired: false,
      uncertainties: [
        "Métadonnées d'un catalogue non officiel, sans validation éditoriale.",
        "Aucune correspondance saison/saga déduite de la numérotation.",
        ...(metadata["End date"]
          ? [
              "Dates de la fiche conservées telles qu'observées ; non canonisées.",
            ]
          : []),
      ],
    },
  };
}

export function initAnimeCatalog(a: Archive) {
  a.db
    .run(`CREATE TABLE IF NOT EXISTS anime_works(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,series TEXT NOT NULL,kind TEXT NOT NULL,language TEXT NOT NULL,season INTEGER,source_tier TEXT NOT NULL,source_hash TEXT NOT NULL,fetched_at TEXT NOT NULL,advertised_episodes INTEGER,audit_json TEXT NOT NULL,metadata_json TEXT NOT NULL,raw_path TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS anime_episodes(work_id TEXT NOT NULL REFERENCES anime_works(id) ON DELETE CASCADE,url TEXT NOT NULL,title TEXT NOT NULL,number INTEGER,season INTEGER,source_url TEXT NOT NULL,PRIMARY KEY(work_id,url));
  CREATE TABLE IF NOT EXISTS anime_relations(work_id TEXT NOT NULL REFERENCES anime_works(id) ON DELETE CASCADE,target_url TEXT NOT NULL,relation TEXT NOT NULL,source_url TEXT NOT NULL,PRIMARY KEY(work_id,target_url,relation));
  CREATE TABLE IF NOT EXISTS anime_catalog_pages(url TEXT PRIMARY KEY,source_url TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',source_hash TEXT,fetched_at TEXT,raw_path TEXT,error TEXT);`);
}
export function storeAnimeCatalogue(
  a: Archive,
  listing: AnimeListing,
  source: {
    hash: string;
    fetchedAt: string;
    rawPath: string;
    discoveredFrom?: string;
  },
) {
  initAnimeCatalog(a);
  const id = animeWorkId(listing.url);
  a.db.transaction(() => {
    a.db
      .query(
        `INSERT INTO anime_works VALUES(?,?,?,?,?,?,NULL,'unofficial',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,language=excluded.language,source_hash=excluded.source_hash,fetched_at=excluded.fetched_at,advertised_episodes=excluded.advertised_episodes,audit_json=excluded.audit_json,metadata_json=excluded.metadata_json,raw_path=excluded.raw_path`,
      )
      .run(
        id,
        listing.url,
        listing.title,
        "Fairy Tail",
        listing.kind,
        listing.language,
        source.hash,
        source.fetchedAt,
        listing.advertisedEpisodes,
        JSON.stringify(listing.audit),
        JSON.stringify(listing.metadata),
        source.rawPath,
      );
    a.db.query("DELETE FROM anime_episodes WHERE work_id=?").run(id);
    a.db.query("DELETE FROM anime_relations WHERE work_id=?").run(id);
    for (const ep of listing.episodes)
      a.db
        .query("INSERT INTO anime_episodes VALUES(?,?,?,?,NULL,?)")
        .run(id, ep.url, ep.title, ep.number, listing.url);
    for (const related of listing.related)
      a.db
        .query("INSERT OR IGNORE INTO anime_relations VALUES(?,?,?,?)")
        .run(id, related.url, "observed-link", listing.url);
    if (source.discoveredFrom)
      a.db
        .query("INSERT OR IGNORE INTO anime_relations VALUES(?,?,?,?)")
        .run(id, listing.url, "discovered-in", source.discoveredFrom);
    const doc = [
      `# ${listing.title}`,
      `Catalogue non officiel. Source : ${listing.url}`,
      `Type observé : ${listing.kind}. Langue : ${listing.language}. Saisons/sagas non établies.`,
      ...listing.episodes.map((e) => `${e.title} — ${e.url}`),
    ].join("\n");
    a.ingest(listing.url, listing.title, doc.slice(0, 250000), "fr");
  })();
  return id;
}
const tableExists = (a: Archive) =>
  !!a.db
    .query(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='anime_works'",
    )
    .get();
function pageOptions(
  options: { limit?: number; offset?: number },
  maximum = 1000,
) {
  const limit = options.limit ?? 50,
    offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximum ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error("Pagination invalide");
  return { limit, offset };
}
export function listAnimeWorks(
  a: Archive,
  options: { limit?: number; offset?: number } = {},
) {
  const { limit, offset } = pageOptions(options);
  return tableExists(a)
    ? a.db
        .query(
          "SELECT w.*,(SELECT count(*) FROM anime_episodes e WHERE e.work_id=w.id) AS listed_episodes FROM anime_works w ORDER BY title,url LIMIT ? OFFSET ?",
        )
        .all(limit, offset)
    : [];
}
export function getAnimeWork(
  a: Archive,
  id: string,
  options: { limit?: number; offset?: number } = {},
) {
  const { limit, offset } = pageOptions(options);
  if (!tableExists(a)) return null;
  const work = a.db.query("SELECT * FROM anime_works WHERE id=?").get(id);
  if (!work) return null;
  return {
    work,
    episodes: a.db
      .query(
        "SELECT * FROM anime_episodes WHERE work_id=? ORDER BY number,url LIMIT ? OFFSET ?",
      )
      .all(id, limit, offset),
    relations: a.db
      .query(
        "SELECT * FROM anime_relations WHERE work_id=? ORDER BY target_url",
      )
      .all(id),
  };
}
export function animeCatalogStatus(a: Archive) {
  return {
    source: ANIME_CATALOG_URL,
    sourceTier: "unofficial",
    mediaAcquired: false,
    exhaustive: false,
    counts: tableExists(a)
      ? Object.fromEntries(
          ["anime_works", "anime_episodes", "anime_relations"].map((t) => [
            t,
            a.db.query<{ n: number }, []>(`SELECT count(*) n FROM ${t}`).get()!
              .n,
          ]),
        )
      : { anime_works: 0, anime_episodes: 0, anime_relations: 0 },
    coverage: tableExists(a)
      ? a.db
          .query(
            "SELECT id,title,advertised_episodes,audit_json FROM anime_works ORDER BY title",
          )
          .all()
      : [],
  };
}

async function request(url: string): Promise<{ body: string; engine: string }> {
  const target = new URL(url);
  if (
    target.origin !== ORIGIN ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !(
      animeWorkUrl(url) ||
      /^\/(?:robots\.txt|sitemap_index\.xml|wp-manga-sitemap\d*\.xml)$/.test(
        target.pathname,
      )
    )
  )
    throw new Error("Requête catalogue hors périmètre");
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": "FairyTailLocalArchive/0.1 (public catalogue metadata)",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > MAX_BYTES)
        throw new Error("Réponse trop volumineuse");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Corps absent");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) throw new Error("Réponse trop volumineuse");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return { body: new TextDecoder().decode(bytes), engine: "Bun.fetch" };
    } catch (error) {
      failure = error;
      if (attempt === 0) await Bun.sleep(1000);
    }
  // Public static HTTP only, never stealth, session import or challenge bypass.
  const native = (await aphrodyWeb(
    ["fetch", url, "--profile", "http", "--json"],
    45000,
  )) as {
    body?: string;
    truncated?: boolean;
    transport?: { status?: number; final_url?: string };
  };
  if (
    native.transport?.status !== 200 ||
    native.transport.final_url !== url ||
    native.truncated ||
    typeof native.body !== "string" ||
    new TextEncoder().encode(native.body).length > MAX_BYTES
  )
    throw new Error(`Catalogue inaccessible : ${String(failure)}`);
  return { body: native.body, engine: "aphrody.web.fetch.http" };
}

export async function collectAnimeCatalog(
  a: Archive,
  options: { maxPages?: number; signal?: AbortSignal } = {},
) {
  const budget = options.maxPages ?? 20;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100)
    throw new Error("maxPages: entier de1à100");
  return withCollectorLease(
    a,
    "anime-catalog:voir-anime",
    async (assertOwner) => {
      initAnimeCatalog(a);
      const root = resolve("data/anime-catalog");
      mkdirSync(root, { recursive: true });
      const robots = await request(`${ORIGIN}/robots.txt`);
      assertOwner();
      const robotsHash = hash(robots.body);
      await Bun.write(resolve(root, `${robotsHash}.robots.txt`), robots.body);
      assertOwner();
      const enqueue = (url: string, source: string, kind: string) =>
        a.db
          .query(
            "INSERT OR IGNORE INTO anime_catalog_pages(url,source_url,kind) VALUES(?,?,?)",
          )
          .run(url, source, kind);
      enqueue(ANIME_CATALOG_URL, ANIME_CATALOG_URL, "work");
      for (const match of robots.body.matchAll(/^Sitemap:\s*(\S+)/gim)) {
        const u = new URL(match[1]!);
        if (
          u.origin === ORIGIN &&
          u.pathname === "/sitemap_index.xml" &&
          !u.search
        )
          enqueue(u.href, `${ORIGIN}/robots.txt`, "sitemap-index");
      }
      const reports: unknown[] = [],
        errors: { url: string; error: string }[] = [];
      const visited = new Set<string>();
      let fetched = 1;
      while (fetched < budget) {
        options.signal?.throwIfAborted();
        assertOwner();
        const job = a.db
          .query<{ url: string; source_url: string; kind: string }, []>(
            "SELECT url,source_url,kind FROM anime_catalog_pages WHERE state!='done' ORDER BY CASE kind WHEN 'work' THEN 0 WHEN 'sitemap-index' THEN 1 ELSE 2 END,rowid",
          )
          .all()
          .find((j) => !visited.has(j.url));
        if (!job) break;
        visited.add(job.url);
        if (!robotsAllowed(robots.body, new URL(job.url).pathname)) {
          errors.push({ url: job.url, error: "robots.txt interdit ce chemin" });
          continue;
        }
        fetched++;
        await Bun.sleep(1000);
        try {
          const response = await request(job.url);
          assertOwner();
          const sourceHash = hash(response.body),
            fetchedAt = new Date().toISOString(),
            rawPath = resolve(
              root,
              `${sourceHash}.${job.kind === "work" ? "html" : "xml"}`,
            );
          await Bun.write(rawPath, response.body);
          assertOwner();
          if (job.kind === "work") {
            const listing = await parseAnimeCatalogue(response.body, job.url);
            assertOwner();
            const id = storeAnimeCatalogue(a, listing, {
              hash: sourceHash,
              fetchedAt,
              rawPath,
              discoveredFrom: job.source_url,
            });
            for (const link of listing.related)
              enqueue(link.url, listing.url, "work");
            reports.push({
              id,
              title: listing.title,
              url: job.url,
              engine: response.engine,
              ...listing.audit,
            });
          } else
            for (const match of response.body.matchAll(
              /<loc>\s*([^<]+)\s*<\/loc>/gi,
            )) {
              const candidate = match[1]!.replace(/&amp;/g, "&").trim();
              const work = animeWorkUrl(candidate);
              if (work) enqueue(work, job.url, "work");
              else {
                let u: URL;
                try {
                  u = new URL(candidate);
                } catch {
                  continue;
                }
                if (
                  job.kind === "sitemap-index" &&
                  u.origin === ORIGIN &&
                  /^\/wp-manga-sitemap\d*\.xml$/.test(u.pathname) &&
                  !u.search
                )
                  enqueue(u.href, job.url, "sitemap");
              }
            }
          a.db
            .query(
              "UPDATE anime_catalog_pages SET state='done',source_hash=?,fetched_at=?,raw_path=?,error=NULL WHERE url=?",
            )
            .run(sourceHash, fetchedAt, rawPath, job.url);
        } catch (error) {
          assertOwner();
          a.db
            .query(
              "UPDATE anime_catalog_pages SET state='failed',error=? WHERE url=?",
            )
            .run(String(error), job.url);
          errors.push({ url: job.url, error: String(error) });
        }
      }
      const result = {
        fetched,
        budget,
        robots: {
          url: `${ORIGIN}/robots.txt`,
          hash: robotsHash,
          policy: "search metadata; no training",
          signals: robots.body.match(/^Content-Signal:.+$/gim) ?? [],
        },
        reports,
        errors,
        pending: a.db
          .query(
            "SELECT url,kind,state,error FROM anime_catalog_pages WHERE state!='done' ORDER BY url",
          )
          .all(),
        status: animeCatalogStatus(a),
        exhaustive: false,
        mediaAcquired: false,
      };
      assertOwner();
      await Bun.write(
        resolve(root, "report.json"),
        JSON.stringify(result, null, 2),
      );
      return result;
    },
  );
}
