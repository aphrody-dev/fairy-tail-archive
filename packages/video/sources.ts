import type { Archive } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";

export const NETFLIX_TITLE_URL = "https://www.netflix.com/title/70266998";
export const YOUTUBE_CHANNEL_URL =
  "https://www.youtube.com/@fairytailanimefr-officiel5083/videos";
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
function at(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) value = object(value)[key];
  return value;
}
function nodes(root: unknown): JsonObject[] {
  const result: JsonObject[] = [],
    pending: unknown[] = [root];
  while (pending.length && result.length < 200000) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as JsonObject;
    result.push(record);
    pending.push(...Object.values(record));
  }
  return result;
}

export type MediaItem = {
  itemKey: string;
  providerId: string | null;
  title: string;
  url: string;
  episode: number | null;
  season: number | null;
  durationSeconds: number | null;
  summary: string;
  audioLanguages: string[];
  subtitleLanguages: string[];
};
export type MediaListing = {
  provider: "netflix" | "youtube";
  sourceId: string;
  url: string;
  title: string;
  description: string;
  language: string;
  advertisedSeasons: number | null;
  items: MediaItem[];
  continuation: string | null;
  clientVersion?: string;
};

function duration(value: string): number | null {
  if (!/^\d+(?::\d{2}){1,2}$/.test(value)) return null;
  return value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** Reads JSON literals already delivered in a public HTML document; never evals script. */
export function embeddedJson(html: string, marker: string): unknown {
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error(`Données publiques absentes: ${marker}`);
  const start = html.indexOf("{", markerAt + marker.length);
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i >= 0 && i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0)
      return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error(`JSON public incomplet: ${marker}`);
}

function youtubeItems(root: unknown): {
  items: MediaItem[];
  continuation: string | null;
} {
  const items = new Map<string, MediaItem>();
  let continuation: string | null = null;
  for (const node of nodes(root)) {
    const continuationItem = node.continuationItemRenderer;
    const token = text(
      at(
        continuationItem,
        "continuationEndpoint",
        "continuationCommand",
        "token",
      ),
    );
    if (token) continuation = token;
    const modern = object(node.lockupViewModel),
      legacy = object(node.videoRenderer);
    const isModern = modern.contentType === "LOCKUP_CONTENT_TYPE_VIDEO";
    const id = text(isModern ? modern.contentId : legacy.videoId);
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const legacyTitle = object(legacy.title);
    const runs = Array.isArray(legacyTitle.runs)
      ? legacyTitle.runs.map((r) => text(object(r).text)).join("")
      : "";
    const title =
      text(
        at(modern, "metadata", "lockupMetadataViewModel", "title", "content"),
      ) ||
      text(legacyTitle.simpleText) ||
      runs;
    if (!title) continue;
    let length = text(at(legacy, "lengthText", "simpleText"));
    for (const child of nodes(modern.contentImage)) {
      const badge = object(child.thumbnailBadgeViewModel);
      if (duration(text(badge.text)) !== null) {
        length = text(badge.text);
        break;
      }
    }
    const episode = /\b(?:EP(?:ISODE)?|ÉPISODE)\s*[-.:]?\s*(\d+)/iu.exec(title);
    const season = /\b(?:SAISON|SEASON|S)\s*[-.:]?\s*(\d+)/iu.exec(title);
    const vostfr = /\bVOSTFR\b/i.test(title),
      vf = /\bVF\b/i.test(title);
    items.set(id, {
      itemKey: id,
      providerId: id,
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      episode: episode ? Number(episode[1]) : null,
      season: season ? Number(season[1]) : null,
      durationSeconds: duration(length),
      summary: "",
      audioLanguages: vostfr ? ["ja"] : vf ? ["fr"] : [],
      subtitleLanguages: vostfr ? ["fr"] : [],
    });
  }
  return { items: [...items.values()], continuation };
}

export function parseYoutubeInitial(html: string): MediaListing {
  const root = embeddedJson(html, "var ytInitialData =");
  const metadata = object(at(root, "metadata", "channelMetadataRenderer"));
  const sourceId = text(metadata.externalId),
    title = text(metadata.title);
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(sourceId) || !title)
    throw new Error("Métadonnées de chaîne YouTube absentes");
  const tabs = at(root, "contents", "twoColumnBrowseResultsRenderer", "tabs");
  const selected = Array.isArray(tabs)
    ? tabs
        .map((t) => object(object(t).tabRenderer))
        .find((t) => t.selected === true)
    : undefined;
  if (!selected?.content) throw new Error("Liste publique de vidéos absente");
  const listing = youtubeItems(selected.content);
  let clientVersion: string | undefined;
  try {
    clientVersion =
      text(
        at(
          embeddedJson(html, "ytcfg.set("),
          "INNERTUBE_CONTEXT",
          "client",
          "clientVersion",
        ),
      ) || undefined;
  } catch {
    /* only required for continuation */
  }
  return {
    provider: "youtube",
    sourceId,
    url: YOUTUBE_CHANNEL_URL,
    title,
    description: text(metadata.description),
    language: "fr",
    advertisedSeasons: null,
    ...listing,
    clientVersion,
  };
}

export function parseYoutubeContinuation(root: unknown): {
  items: MediaItem[];
  continuation: string | null;
} {
  if (
    object(root).error ||
    (!Array.isArray(object(root).onResponseReceivedActions) &&
      !Array.isArray(object(root).onResponseReceivedEndpoints))
  )
    throw new Error("Continuation YouTube invalide");
  return youtubeItems(root);
}

/** The public Netflix listing exposes item ordinals, not authenticated playback IDs. */
export function parseNetflixMarkdown(body: string): MediaListing {
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  if (!title) throw new Error("Titre Netflix public absent");
  const section =
    body.split("## Episodes")[1]?.split("## More Details")[0] ?? "";
  const episodes = [...section.matchAll(/^\s+(\d+)\\?\.\s+(.+)$/gm)];
  const audio = /#### Audio\s+([^#]+)/.exec(body)?.[1] ?? "";
  const subtitles = /#### Subtitles\s+([^#]+)/.exec(body)?.[1] ?? "";
  const languages = (input: string) => [
    ...(/French/i.test(input) ? ["fr"] : []),
    ...(/Japanese/i.test(input) ? ["ja"] : []),
    ...(/English/i.test(input) ? ["en"] : []),
  ];
  const items: MediaItem[] = episodes.map((entry, index) => {
    const number = Number(entry[1]),
      start = entry.index!;
    const end = episodes[index + 1]?.index ?? section.length;
    const previous = section.slice(0, start).trim().split("\n").at(-1) ?? "";
    const minutes = /(\d+)m$/.exec(previous);
    const summary = section
      .slice(start + entry[0].length, end)
      .split(/\n- !\[\]/)[0]!
      .trim();
    return {
      itemKey: `70266998:public-listing:${number}`,
      providerId: null,
      title: entry[2]!.trim(),
      url: `${NETFLIX_TITLE_URL}#episodes`,
      episode: number,
      season: null,
      durationSeconds: minutes ? Number(minutes[1]) * 60 : null,
      summary,
      audioLanguages: languages(audio),
      subtitleLanguages: languages(subtitles),
    };
  });
  const seasons = /- (\d+) Seasons/.exec(body);
  return {
    provider: "netflix",
    sourceId: "70266998",
    url: NETFLIX_TITLE_URL,
    title,
    description:
      body.split("## Episodes")[0]?.split("## Fairy Tail")[1]?.trim() ?? "",
    language: "en",
    advertisedSeasons: seasons ? Number(seasons[1]) : null,
    items,
    continuation: null,
  };
}

function schema(archive: Archive) {
  archive.db
    .run(`CREATE TABLE IF NOT EXISTS media_sources(provider TEXT NOT NULL,source_id TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,language TEXT NOT NULL,advertised_seasons INTEGER,continuation TEXT,client_version TEXT,provenance_json TEXT NOT NULL,fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(provider,source_id));
    CREATE TABLE IF NOT EXISTS media_catalog(provider TEXT NOT NULL,source_id TEXT NOT NULL,item_key TEXT NOT NULL,provider_id TEXT,title TEXT NOT NULL,url TEXT NOT NULL,episode_number INTEGER,season_number INTEGER,duration_seconds INTEGER,summary TEXT NOT NULL,audio_languages TEXT NOT NULL,subtitle_languages TEXT NOT NULL,PRIMARY KEY(provider,item_key),FOREIGN KEY(provider,source_id) REFERENCES media_sources(provider,source_id));
    CREATE TABLE IF NOT EXISTS media_local_links(provider TEXT NOT NULL,item_key TEXT NOT NULL,episode_id TEXT NOT NULL REFERENCES episodes(id),PRIMARY KEY(provider,item_key),FOREIGN KEY(provider,item_key) REFERENCES media_catalog(provider,item_key));`);
}

export function saveMediaListing(
  archive: Archive,
  listing: MediaListing,
  provenance: Record<string, unknown>,
) {
  schema(archive);
  archive.db.transaction(() => {
    archive.db
      .query(
        "INSERT INTO media_sources(provider,source_id,url,title,description,language,advertised_seasons,continuation,client_version,provenance_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET title=excluded.title,description=excluded.description,language=excluded.language,advertised_seasons=excluded.advertised_seasons,continuation=excluded.continuation,client_version=excluded.client_version,provenance_json=excluded.provenance_json,fetched_at=CURRENT_TIMESTAMP",
      )
      .run(
        listing.provider,
        listing.sourceId,
        listing.url,
        listing.title,
        listing.description,
        listing.language,
        listing.advertisedSeasons,
        listing.continuation,
        listing.clientVersion ?? null,
        JSON.stringify(provenance),
      );
    for (const item of listing.items)
      archive.db
        .query(
          "INSERT INTO media_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,item_key) DO UPDATE SET provider_id=excluded.provider_id,title=excluded.title,url=excluded.url,episode_number=excluded.episode_number,season_number=excluded.season_number,duration_seconds=excluded.duration_seconds,summary=excluded.summary,audio_languages=excluded.audio_languages,subtitle_languages=excluded.subtitle_languages",
        )
        .run(
          listing.provider,
          listing.sourceId,
          item.itemKey,
          item.providerId,
          item.title,
          item.url,
          item.episode,
          item.season,
          item.durationSeconds,
          item.summary,
          JSON.stringify(item.audioLanguages),
          JSON.stringify(item.subtitleLanguages),
        );
  })();
  const indexed = archive.db
    .query<{ title: string; summary: string }, [string, string]>(
      "SELECT title,summary FROM media_catalog WHERE provider=? AND source_id=? ORDER BY episode_number,title",
    )
    .all(listing.provider, listing.sourceId);
  archive.ingest(
    listing.url,
    listing.title,
    [
      listing.description,
      ...indexed.map((item) => `${item.title}\n${item.summary}`),
    ].join("\n\n"),
    listing.language,
  );
}

async function boundedText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Réponse vide");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024) throw new Error("Réponse publique >8 Mio");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

export async function catalogueVideoSources(
  archive: Archive,
  options: { youtubePages?: number; signal?: AbortSignal } = {},
) {
  const budget = options.youtubePages ?? 5;
  if (!Number.isInteger(budget) || budget < 1 || budget > 100)
    throw new Error("youtubePages: entier de 1 à 100");
  schema(archive);
  const report: Record<string, unknown>[] = [];
  try {
    const fetched = object(
      await aphrodyWeb(["fetch", NETFLIX_TITLE_URL, "--json"]),
    );
    const listing = parseNetflixMarkdown(text(fetched.body));
    saveMediaListing(archive, listing, {
      requestedUrl: NETFLIX_TITLE_URL,
      transport: fetched.transport,
      rendering: fetched.rendering,
      scope: "public landing page; playback not acquired",
    });
    report.push({
      provider: "netflix",
      title: listing.title,
      items: listing.items.length,
      advertisedSeasons: listing.advertisedSeasons,
      exhaustive: false,
    });
  } catch (error) {
    report.push({ provider: "netflix", error: String(error) });
  }
  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    const response = await fetch(YOUTUBE_CHANNEL_URL, {
      signal,
      redirect: "follow",
    });
    const listing = parseYoutubeInitial(await boundedText(response));
    const previous = archive.db
      .query<
        { continuation: string | null; client_version: string | null },
        [string]
      >(
        "SELECT continuation,client_version FROM media_sources WHERE provider='youtube' AND source_id=?",
      )
      .get(listing.sourceId);
    const resume = previous?.continuation;
    const firstContinuation = listing.continuation;
    listing.continuation = resume ?? firstContinuation;
    listing.clientVersion =
      listing.clientVersion ?? previous?.client_version ?? undefined;
    saveMediaListing(archive, listing, {
      requestedUrl: YOUTUBE_CHANNEL_URL,
      finalUrl: response.url,
      transport: "Bun.fetch public HTML + ytInitialData",
      resumed: !!resume,
    });
    let imported = listing.items.length,
      pages = 1;
    const tokens = new Set<string>();
    while (listing.continuation && pages < budget) {
      if (!listing.clientVersion)
        throw new Error(
          "Version du client public absente pour la continuation",
        );
      if (tokens.has(listing.continuation))
        throw new Error("Continuation YouTube répétée");
      tokens.add(listing.continuation);
      await Bun.sleep(1000);
      const result = await fetch(
        "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: listing.clientVersion,
                hl: "fr",
                gl: "FR",
              },
            },
            continuation: listing.continuation,
          }),
        },
      );
      const next = parseYoutubeContinuation(
        JSON.parse(await boundedText(result)),
      );
      listing.items = next.items;
      listing.continuation = next.continuation;
      saveMediaListing(archive, listing, {
        requestedUrl: YOUTUBE_CHANNEL_URL,
        transport: "Bun.fetch anonymous public continuation",
        page: pages + 1,
      });
      imported += next.items.length;
      pages++;
    }
    report.push({
      provider: "youtube",
      title: listing.title,
      sourceId: listing.sourceId,
      observedItems: imported,
      pages,
      pendingContinuation: !!listing.continuation,
      exhaustive: false,
    });
  } catch (error) {
    report.push({ provider: "youtube", error: String(error) });
  }
  return { report, catalog: mediaCatalog(archive) };
}

export function mediaCatalog(archive: Archive) {
  schema(archive);
  return {
    sources: archive.db
      .query(
        "SELECT provider,source_id,url,title,description,language,advertised_seasons,continuation IS NOT NULL AS pending_continuation,provenance_json,fetched_at FROM media_sources ORDER BY provider,source_id",
      )
      .all(),
    items: archive.db
      .query(
        "SELECT c.*,l.episode_id FROM media_catalog c LEFT JOIN media_local_links l ON l.provider=c.provider AND l.item_key=c.item_key ORDER BY c.provider,c.season_number,c.episode_number,c.title",
      )
      .all(),
  };
}

export function linkLocalEpisode(
  archive: Archive,
  provider: string,
  itemKey: string,
  episodeId: string,
) {
  schema(archive);
  archive.db
    .query("INSERT OR REPLACE INTO media_local_links VALUES(?,?,?)")
    .run(provider, itemKey, episodeId);
}
