import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { plainText } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";
import { embeddedJson } from "../video/sources.ts";
import { contained } from "../video/index.ts";

export type StreamKind =
  "embed" | "hls" | "dash" | "mp4" | "watch" | "catalogue";
export function parseStreamKind(
  value: string | null | undefined,
): StreamKind | undefined {
  if (value == null) return undefined;
  if (["embed", "hls", "dash", "mp4", "watch", "catalogue"].includes(value))
    return value as StreamKind;
  throw new Error("Unknown stream kind");
}
export type StreamInput = {
  provider: string;
  providerId: string;
  kind: StreamKind;
  title: string;
  url: string;
  sourceUrl: string;
  language: string;
  audioLanguages?: string[];
  subtitleLanguages?: string[];
  availableRegions?: string[];
  access: "public" | "subscription" | "unknown" | "restricted";
  status: string;
  mime?: string | null;
  expiresAt?: string | null;
  ephemeral?: boolean;
  evidence: Record<string, unknown>;
  variant?: string;
};
export type StreamDTO = Omit<StreamInput, "variant"> & {
  id: number;
  audioLanguages: string[];
  subtitleLanguages: string[];
  availableRegions: string[];
  mime: string | null;
  fetchedAt: string;
  expiresAt: string | null;
  ephemeral: boolean;
  expired: boolean;
  playbackVerified: false;
  cachedFileUrl: string | null;
  indexedFrames: number;
  scope: "promotional-preview" | null;
};
type Row = {
  id: number;
  provider: string;
  provider_id: string;
  kind: StreamKind;
  title: string;
  url: string;
  source_url: string;
  language: string;
  audio_languages: string;
  subtitle_languages: string;
  regions_json: string;
  access: StreamInput["access"];
  status: string;
  mime: string | null;
  fetched_at: string;
  expires_at: string | null;
  ephemeral: number;
  evidence_json: string;
};
const OFFICIAL = ["https://www.fairytail100yq.com", "https://fairytail-tv.com"];
const TVTOKYO =
  "https://www.tv-tokyo.co.jp/anime/fairytail/sp/story/index.html";
const NETFLIX = "https://www.netflix.com/title/70266998";
const KINDS: StreamKind[] = [
  "embed",
  "hls",
  "dash",
  "mp4",
  "watch",
  "catalogue",
];
function tableExists(a: Archive, table: string) {
  return !!a.db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(table);
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function path(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) value = obj(value)[key];
  return value;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}
function safeUrl(address: string): URL {
  const u = new URL(address);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("URL de flux HTTPS publique requise");
  return u;
}
function official(address: string): boolean {
  try {
    const u = safeUrl(address);
    return (
      OFFICIAL.includes(u.origin) &&
      ["/", "/movie/"].includes(u.pathname) &&
      !u.search
    );
  } catch {
    return false;
  }
}
function mediaHost(provider: string, url: URL): boolean {
  return (
    (provider === "youtube" &&
      (url.hostname === "googlevideo.com" ||
        url.hostname.endsWith(".googlevideo.com"))) ||
    (provider === "netflix" &&
      (url.hostname === "nflxso.net" || url.hostname.endsWith(".nflxso.net")))
  );
}
function validate(input: StreamInput) {
  if (!KINDS.includes(input.kind)) throw new Error("Type de flux inconnu");
  const u = safeUrl(input.url),
    source = safeUrl(input.sourceUrl);
  if (input.provider === "youtube") {
    if (!["watch", "embed", "hls", "dash", "mp4"].includes(input.kind))
      throw new Error("Type de ressource YouTube hors périmètre");
    if (!/^[A-Za-z0-9_-]{11}$/.test(input.providerId))
      throw new Error("ID YouTube invalide");
    const sourceIsWatch =
      source.origin === "https://www.youtube.com" &&
      source.pathname === "/watch" &&
      source.searchParams.get("v") === input.providerId;
    if (!sourceIsWatch && !official(source.href))
      throw new Error("Source YouTube non observée dans le périmètre officiel");
    if (
      input.kind === "watch" &&
      (u.origin !== "https://www.youtube.com" ||
        u.pathname !== "/watch" ||
        u.searchParams.get("v") !== input.providerId)
    )
      throw new Error("URL watch incohérente");
    if (
      input.kind === "embed" &&
      (u.origin !== "https://www.youtube.com" ||
        u.pathname !== `/embed/${input.providerId}`)
    )
      throw new Error("URL embed incohérente");
  } else if (input.provider === "netflix") {
    if (!["catalogue", "hls", "dash", "mp4"].includes(input.kind))
      throw new Error("Type de ressource Netflix hors périmètre");
    if (input.providerId !== "70266998" || source.href !== NETFLIX)
      throw new Error("Source Netflix hors périmètre");
    if (input.kind === "catalogue" && u.href !== NETFLIX)
      throw new Error("Catalogue Netflix incohérent");
  } else if (input.provider === "official-site") {
    if (
      !official(source.href) ||
      u.href !== source.href ||
      input.kind !== "catalogue"
    )
      throw new Error("Site officiel hors périmètre");
  } else if (input.provider === "tv-tokyo") {
    if (
      source.href !== TVTOKYO ||
      u.href !== source.href ||
      input.kind !== "catalogue"
    )
      throw new Error("Source TVTokyo hors périmètre");
  } else throw new Error("Fournisseur de flux non configuré");
  if (
    ["hls", "dash", "mp4"].includes(input.kind) &&
    (!mediaHost(input.provider, u) ||
      /\.(?:jpe?g|png|webp|gif|svg)$/i.test(u.pathname))
  )
    throw new Error("Origine ou ressource média non autorisée");
}
export function initStreams(a: Archive) {
  a.db
    .run(`CREATE TABLE IF NOT EXISTS streams(id INTEGER PRIMARY KEY,stream_key TEXT NOT NULL UNIQUE,provider TEXT NOT NULL,provider_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,source_url TEXT NOT NULL,language TEXT NOT NULL,audio_languages TEXT NOT NULL,subtitle_languages TEXT NOT NULL,regions_json TEXT NOT NULL,access TEXT NOT NULL,status TEXT NOT NULL,mime TEXT,fetched_at TEXT NOT NULL,expires_at TEXT,ephemeral INTEGER NOT NULL DEFAULT 0,evidence_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stream_origins(origin TEXT NOT NULL,provider TEXT NOT NULL,source_url TEXT NOT NULL,observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(origin,provider));`);
}
export function storeStream(a: Archive, input: StreamInput) {
  validate(input);
  initStreams(a);
  const key = [
    input.provider,
    input.providerId,
    input.kind,
    input.variant ?? "primary",
  ].join("|");
  a.db
    .query(
      "INSERT INTO streams(stream_key,provider,provider_id,kind,title,url,source_url,language,audio_languages,subtitle_languages,regions_json,access,status,mime,fetched_at,expires_at,ephemeral,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stream_key) DO UPDATE SET title=excluded.title,url=excluded.url,source_url=excluded.source_url,language=excluded.language,audio_languages=excluded.audio_languages,subtitle_languages=excluded.subtitle_languages,regions_json=excluded.regions_json,access=excluded.access,status=excluded.status,mime=excluded.mime,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,ephemeral=excluded.ephemeral,evidence_json=excluded.evidence_json",
    )
    .run(
      key,
      input.provider,
      input.providerId,
      input.kind,
      input.title,
      input.url,
      input.sourceUrl,
      input.language,
      JSON.stringify(input.audioLanguages ?? []),
      JSON.stringify(input.subtitleLanguages ?? []),
      JSON.stringify(input.availableRegions ?? []),
      input.access,
      input.status,
      input.mime ?? null,
      new Date().toISOString(),
      input.expiresAt ?? null,
      input.ephemeral ? 1 : 0,
      JSON.stringify(input.evidence),
    );
  a.db
    .query(
      "INSERT OR IGNORE INTO stream_origins(origin,provider,source_url) VALUES(?,?,?)",
    )
    .run(new URL(input.url).origin, input.provider, input.sourceUrl);
  return a.db
    .query<{ id: number }, [string]>(
      "SELECT id FROM streams WHERE stream_key=?",
    )
    .get(key)!.id;
}
function localCache(
  a: Archive,
  id: number,
): Pick<StreamDTO, "cachedFileUrl" | "indexedFrames" | "scope"> {
  const empty = { cachedFileUrl: null, indexedFrames: 0, scope: null };
  if (!tableExists(a, "stream_local_assets")) return empty;
  const cached = a.db
    .query<
      {
        path: string;
        sha256: string;
        bytes: number;
        kind: string;
        episode_id: string;
      },
      [number]
    >(
      "SELECT path,sha256,bytes,kind,episode_id FROM stream_local_assets WHERE stream_id=?",
    )
    .get(id);
  if (
    !cached ||
    cached.kind !== "promotional-preview" ||
    !/^[a-f0-9]{64}$/.test(cached.sha256) ||
    cached.bytes <= 0
  )
    return empty;
  try {
    const path = contained(resolve("data/media"), cached.path);
    if (Bun.file(path).size !== cached.bytes) return empty;
    const indexed =
      a.db
        .query<{ n: number }, [string]>(
          "SELECT count(*) n FROM frames WHERE episode_id=?",
        )
        .get(cached.episode_id)?.n ?? 0;
    return {
      cachedFileUrl: `/streams/${id}/file`,
      indexedFrames: indexed,
      scope: "promotional-preview",
    };
  } catch {
    return empty;
  }
}
function dto(a: Archive, row: Row): StreamDTO {
  return {
    id: row.id,
    provider: row.provider,
    providerId: row.provider_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    sourceUrl: row.source_url,
    language: row.language,
    audioLanguages: JSON.parse(row.audio_languages),
    subtitleLanguages: JSON.parse(row.subtitle_languages),
    availableRegions: JSON.parse(row.regions_json),
    access: row.access,
    status: row.status,
    mime: row.mime,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    ephemeral: !!row.ephemeral,
    expired: !!row.expires_at && Date.parse(row.expires_at) <= Date.now(),
    playbackVerified: false,
    evidence: JSON.parse(row.evidence_json),
    ...localCache(a, row.id),
  };
}
export function streamCatalog(
  a: Archive,
  options: {
    provider?: string;
    kind?: StreamKind;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = options.limit ?? 50,
    offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (options.kind && !KINDS.includes(options.kind))
  )
    throw new Error("Filtre ou pagination de flux invalide");
  const counts = {
    total: 0,
    hls: 0,
    dash: 0,
    mp4: 0,
    embed: 0,
    watch: 0,
    catalogue: 0,
  };
  if (!tableExists(a, "streams")) return { counts, items: [] as StreamDTO[] };
  for (const row of a.db
    .query<{ kind: StreamKind; n: number }, []>(
      "SELECT kind,count(*) n FROM streams GROUP BY kind",
    )
    .all()) {
    counts[row.kind] = row.n;
    counts.total += row.n;
  }
  const items = a.db
    .query<
      Row,
      [
        string | null,
        string | null,
        string | null,
        string | null,
        number,
        number,
      ]
    >(
      "SELECT * FROM streams WHERE (? IS NULL OR provider=?) AND (? IS NULL OR kind=?) ORDER BY provider,kind,title,id LIMIT ? OFFSET ?",
    )
    .all(
      options.provider ?? null,
      options.provider ?? null,
      options.kind ?? null,
      options.kind ?? null,
      limit,
      offset,
    )
    .map((row) => dto(a, row));
  return { counts, items };
}
export function findStream(a: Archive, id: number): StreamDTO | null {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("ID de flux invalide");
  if (!tableExists(a, "streams")) return null;
  const row = a.db
    .query<Row, [number]>("SELECT * FROM streams WHERE id=?")
    .get(id);
  return row ? dto(a, row) : null;
}

export function inspectHlsManifest(body: string) {
  if (
    body.length > 1024 * 1024 ||
    !/^#EXTM3U(?:\r?\n|$)/.test(body.replace(/^\uFEFF/, "").trimStart())
  )
    throw new Error("Réponse sans signature HLS #EXTM3U");
  const lines = body.split(/\r?\n/),
    variants = lines.filter((l) => l.startsWith("#EXT-X-STREAM-INF:")).length,
    segments = lines.filter((l) => l.startsWith("#EXTINF:")).length;
  if (!variants && !segments)
    throw new Error("Playlist HLS sans variantes ni segments");
  if (lines.includes("#EXT-X-IMAGES-ONLY"))
    throw new Error("Playlist d'images, pas de flux vidéo");
  const encryption = lines.filter(
    (l) => l.startsWith("#EXT-X-KEY:") && !/METHOD=NONE(?:,|$)/.test(l),
  );
  return {
    kind: "hls" as const,
    variants,
    segments,
    encrypted: encryption.length > 0,
    drm: encryption.some((l) => /SAMPLE-AES|KEYFORMAT=/.test(l)),
    endList: lines.includes("#EXT-X-ENDLIST"),
    validation: "signature-and-playlist-tags; playback not exercised",
  };
}
export function inspectDashManifest(body: string) {
  if (
    body.length > 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(body) ||
    !/<(?:[A-Za-z_][\w.-]*:)?MPD\b[^>]*>/.test(body) ||
    !/<(?:[A-Za-z_][\w.-]*:)?Period\b/.test(body) ||
    !/<\/(?:[A-Za-z_][\w.-]*:)?MPD\s*>/.test(body)
  )
    throw new Error("Réponse sans structure de manifeste DASH MPD");
  return {
    kind: "dash" as const,
    periods: (body.match(/<(?:[A-Za-z_][\w.-]*:)?Period\b/g) ?? []).length,
    drm: /<(?:[A-Za-z_][\w.-]*:)?ContentProtection\b/.test(body),
    validation: "MPD/Period signature checks; playback not exercised",
  };
}
async function bounded(response: Response, limit: number) {
  if (!response.ok || !response.body)
    throw new Error(`HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Réponse média au-delà de la borne");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function expiry(url: string, hint?: unknown): string | null {
  let value: number | null = typeof hint === "number" ? hint : null;
  if (typeof hint === "string" && Number.isFinite(Date.parse(hint)))
    return new Date(hint).toISOString();
  if (value === null) {
    const u = new URL(url),
      raw =
        u.searchParams.get("expire") ??
        u.searchParams.get("e") ??
        u.searchParams.get("Expires");
    if (raw && /^\d{10,13}$/.test(raw)) value = Number(raw);
  }
  if (value === null || !Number.isFinite(value)) return null;
  return new Date(value < 100000000000 ? value * 1000 : value).toISOString();
}
export async function probeHls(
  a: Archive,
  idOrUrl: number | string,
  options: { fetcher?: typeof fetch } = {},
) {
  if (!tableExists(a, "streams")) throw new Error("Aucun flux découvert");
  const row =
    typeof idOrUrl === "number"
      ? a.db
          .query<Row, [number]>(
            "SELECT * FROM streams WHERE id=? AND kind='hls'",
          )
          .get(idOrUrl)
      : a.db
          .query<Row, [string]>(
            "SELECT * FROM streams WHERE url=? AND kind='hls'",
          )
          .get(idOrUrl);
  if (!row) throw new Error("URL HLS absente des médias publics déjà observés");
  validate(dto(a, row));
  const response = await (options.fetcher ?? fetch)(row.url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (
    (response.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("image/")
  )
    throw new Error("Une image ne constitue pas un flux HLS");
  const body = new TextDecoder().decode(await bounded(response, 1024 * 1024)),
    inspection = inspectHlsManifest(body);
  a.db
    .query(
      "UPDATE streams SET status='manifest-verified',mime=?,access=?,fetched_at=?,evidence_json=? WHERE id=?",
    )
    .run(
      response.headers.get("content-type"),
      inspection.drm ? "restricted" : row.access,
      new Date().toISOString(),
      JSON.stringify({
        ...JSON.parse(row.evidence_json),
        manifest: inspection,
        httpStatus: response.status,
      }),
      row.id,
    );
  return { stream: findStream(a, row.id), inspection };
}
async function probeDash(a: Archive, id: number) {
  const row = findStream(a, id);
  if (!row) throw new Error("DASH absent");
  validate(row);
  const response = await fetch(row.url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    }),
    body = new TextDecoder().decode(await bounded(response, 1024 * 1024)),
    inspection = inspectDashManifest(body);
  a.db
    .query(
      "UPDATE streams SET status='manifest-verified',mime=?,access=?,fetched_at=?,evidence_json=? WHERE id=?",
    )
    .run(
      response.headers.get("content-type"),
      inspection.drm ? "restricted" : row.access,
      new Date().toISOString(),
      JSON.stringify({
        ...row.evidence,
        manifest: inspection,
        httpStatus: response.status,
      }),
      id,
    );
}
async function probeMp4(a: Archive, id: number) {
  const row = findStream(a, id);
  if (!row) throw new Error("MP4 absent");
  validate(row);
  const response = await fetch(row.url, {
    headers: { Range: "bytes=0-4095" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error(`MP4 HTTP ${response.status}`);
  const reader = response.body.getReader();
  let sample: Uint8Array;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 4096) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value.slice(0, 4096 - size);
      chunks.push(chunk);
      size += chunk.length;
    }
    sample = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      sample.set(chunk, offset);
      offset += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  const mime = response.headers.get("content-type");
  if (
    sample.length < 12 ||
    new TextDecoder().decode(sample.slice(4, 8)) !== "ftyp" ||
    !/(?:video\/mp4|application\/octet-stream)/i.test(mime ?? "")
  )
    throw new Error("Réponse non reconnue comme média MP4 ISO-BMFF");
  a.db
    .query(
      "UPDATE streams SET status='media-header-verified',mime=?,evidence_json=? WHERE id=?",
    )
    .run(
      mime,
      JSON.stringify({
        ...row.evidence,
        httpStatus: response.status,
        contentRange: response.headers.get("content-range"),
        sampleBytes: sample.length,
        signature: "ftyp",
        fullMediaDownloaded: false,
        playbackVerified: false,
      }),
      id,
    );
}

export function parseOfficialVideoLinks(html: string, sourceUrl: string) {
  if (!official(sourceUrl)) throw new Error("Page officielle hors périmètre");
  const found = new Map<
    string,
    { id: string; title: string; sourceUrl: string; embedObserved: boolean }
  >();
  const pattern =
    /(?:(?:https?:)?\/\/(?:www\.)?youtube\.com\/embed\/|showMovie\(['"]|data-youtube=['"])([A-Za-z0-9_-]{11})/g;
  for (const match of html.matchAll(pattern)) {
    const id = match[1]!,
      tail = html.slice(match.index! + match[0].length, match.index! + 1200);
    const title =
      /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(tail)?.[1] ??
      /<p\b[^>]*class=['"][^'"]*movie-ttl[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i.exec(
        tail,
      )?.[1] ??
      "";
    found.set(id, {
      id,
      title: plainText(title) || `Fairy Tail — vidéo officielle ${id}`,
      sourceUrl,
      embedObserved: match[0].includes("youtube.com/embed/"),
    });
  }
  return [...found.values()];
}
type VideoSource = {
  id: string;
  title: string;
  sourceUrl: string;
  language: string;
  audio: string[];
  subtitles: string[];
  scope: string;
  embedObserved?: boolean;
};
function base(video: VideoSource, kind: "watch" | "embed"): StreamInput {
  return {
    provider: "youtube",
    providerId: video.id,
    kind,
    title: video.title,
    url: `https://www.youtube.com/${kind === "watch" ? `watch?v=${video.id}` : `embed/${video.id}`}`,
    sourceUrl: video.sourceUrl,
    language: video.language,
    audioLanguages: video.audio,
    subtitleLanguages: video.subtitles,
    access: "unknown",
    status:
      video.embedObserved && kind === "embed"
        ? "observed-official-embed"
        : "catalogued-not-playback-verified",
    mime: kind === "embed" ? "text/html" : null,
    evidence: {
      scope: video.scope,
      urlDerived: !(kind === "embed" && video.embedObserved),
      languageEvidence: video.audio.length
        ? "catalogue title labels, not decoded audio"
        : "publisher page language; audio unverified",
      playbackVerified: false,
    },
  };
}
async function probeYoutube(
  a: Archive,
  video: VideoSource,
  signal?: AbortSignal,
) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`,
    response = await fetch(watchUrl, {
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  const html = new TextDecoder().decode(
      await bounded(response, 8 * 1024 * 1024),
    ),
    root = obj(embeddedJson(html, "var ytInitialPlayerResponse =")),
    details = obj(root.videoDetails),
    play = obj(root.playabilityStatus),
    streaming = obj(root.streamingData),
    micro = obj(path(root, "microformat", "playerMicroformatRenderer"));
  if (details.videoId && details.videoId !== video.id)
    throw new Error("Réponse player pour une autre vidéo");
  const status = str(play.status) || "UNKNOWN",
    regions = strings(micro.availableCountries),
    embed = str(path(micro, "embed", "iframeUrl"));
  const formats = [
    ...(Array.isArray(streaming.formats) ? streaming.formats : []),
    ...(Array.isArray(streaming.adaptiveFormats)
      ? streaming.adaptiveFormats
      : []),
  ].map(obj);
  const evidence = {
    owner: "Bun.fetch/public ytInitialPlayerResponse",
    scope: video.scope,
    sourcePage: video.sourceUrl,
    playerHttpStatus: response.status,
    playabilityStatus: status,
    reason: str(play.reason) || null,
    playableInEmbed: play.playableInEmbed ?? null,
    serverAbrObserved: !!streaming.serverAbrStreamingUrl,
    adaptiveFormats: formats.map((f) => ({
      itag: f.itag,
      mimeType: f.mimeType,
      quality: f.qualityLabel ?? null,
      publicUrlExposed: !!f.url,
      ciphered: !!f.signatureCipher || !!f.cipher,
    })),
    playbackVerified: false,
  };
  for (const kind of ["watch", "embed"] as const) {
    const record = base(video, kind);
    record.sourceUrl = watchUrl;
    record.availableRegions = regions;
    record.access = status === "OK" ? "public" : "restricted";
    if (kind === "embed" && play.playableInEmbed === false)
      record.access = "restricted";
    record.status =
      status === "OK"
        ? kind === "watch"
          ? "public-player-ok"
          : play.playableInEmbed === true
            ? "embed-declared"
            : play.playableInEmbed === false
              ? "embed-forbidden"
              : "embed-not-verified"
        : "unavailable";
    record.evidence = { ...record.evidence, ...evidence };
    if (kind === "embed" && embed) {
      const u = safeUrl(embed);
      if (
        u.origin === "https://www.youtube.com" &&
        u.pathname === `/embed/${video.id}`
      ) {
        record.url = u.href;
        record.evidence.urlDerived = false;
      }
    }
    storeStream(a, record);
  }
  for (const [kind, field] of [
    ["hls", "hlsManifestUrl"],
    ["dash", "dashManifestUrl"],
  ] as const) {
    const url = str(streaming[field]);
    if (!url) continue;
    const id = storeStream(a, {
      ...base(video, "watch"),
      kind,
      url,
      sourceUrl: watchUrl,
      availableRegions: regions,
      access: status === "OK" ? "public" : "restricted",
      status: "observed-manifest-url",
      ephemeral: true,
      expiresAt: expiry(url),
      evidence: { ...evidence, field },
    });
    try {
      if (kind === "hls") await probeHls(a, id);
      else await probeDash(a, id);
    } catch (error) {
      a.db
        .query(
          "UPDATE streams SET status='probe-failed',evidence_json=? WHERE id=?",
        )
        .run(
          JSON.stringify({ ...evidence, field, probeError: String(error) }),
          id,
        );
    }
  }
  for (const format of formats) {
    const url = str(format.url),
      mime = str(format.mimeType);
    if (!url || !mime.startsWith("video/mp4")) continue;
    const id = storeStream(a, {
      ...base(video, "watch"),
      kind: "mp4",
      url,
      sourceUrl: watchUrl,
      mime,
      access: status === "OK" ? "public" : "restricted",
      status: "observed-format-url",
      ephemeral: true,
      expiresAt: expiry(url),
      variant: `itag-${format.itag}`,
      evidence: {
        ...evidence,
        itag: format.itag,
        scope:
          "public player format; audio pairing and browser playback unverified",
      },
    });
    try {
      await probeMp4(a, id);
    } catch (error) {
      a.db
        .query(
          "UPDATE streams SET status='probe-failed',evidence_json=? WHERE id=?",
        )
        .run(JSON.stringify({ ...evidence, probeError: String(error) }), id);
    }
  }
}

export async function collectStreams(
  a: Archive,
  options: { maxVideos?: number; signal?: AbortSignal } = {},
) {
  const budget = options.maxVideos ?? 20;
  if (!Number.isInteger(budget) || budget < 0 || budget > 100)
    throw new Error("maxVideos: entier0à100");
  initStreams(a);
  const videos = new Map<string, VideoSource>(),
    errors: { source: string; error: string }[] = [];
  if (tableExists(a, "media_catalog"))
    for (const row of a.db
      .query<
        {
          provider_id: string;
          title: string;
          audio_languages: string;
          subtitle_languages: string;
        },
        []
      >(
        "SELECT provider_id,title,audio_languages,subtitle_languages FROM media_catalog WHERE provider='youtube' AND provider_id IS NOT NULL ORDER BY episode_number,title",
      )
      .all()) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(row.provider_id)) continue;
      const audio = strings(JSON.parse(row.audio_languages)),
        subtitles = strings(JSON.parse(row.subtitle_languages));
      videos.set(row.provider_id, {
        id: row.provider_id,
        title: row.title,
        sourceUrl: `https://www.youtube.com/watch?v=${row.provider_id}`,
        language: audio[0] ?? "und",
        audio,
        subtitles,
        scope: "official-channel-public-video; no media download",
      });
    }
  for (const origin of OFFICIAL) {
    const queue = [`${origin}/`],
      seen = new Set<string>();
    for (let i = 0; i < queue.length && i < 2; i++) {
      const url = queue[i]!;
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          }),
          html = new TextDecoder().decode(
            await bounded(response, 2 * 1024 * 1024),
          );
        storeStream(a, {
          provider: "official-site",
          providerId: new URL(origin).hostname,
          kind: "catalogue",
          title: origin.includes("100yq")
            ? "Fairy Tail 100 Years Quest — site officiel"
            : "Fairy Tail — site officiel",
          url,
          sourceUrl: url,
          language: "ja",
          access: "public",
          status: "catalogued",
          mime: response.headers.get("content-type"),
          variant: new URL(url).pathname,
          evidence: {
            httpStatus: response.status,
            scope: "publisher page; videos classified separately",
          },
        });
        for (const video of parseOfficialVideoLinks(html, url))
          videos.set(video.id, {
            ...video,
            language: "ja",
            audio: [],
            subtitles: [],
            scope: "official-site-promotional-video",
          });
        if (/href=['"](?:\.\.\/|\.\/|\/)?movie\/['"]/i.test(html))
          queue.push(`${origin}/movie/`);
      } catch (error) {
        errors.push({ source: url, error: String(error) });
      }
    }
  }
  for (const video of videos.values())
    for (const kind of ["watch", "embed"] as const) {
      const known = a.db
        .query<{ id: number }, [string]>(
          "SELECT id FROM streams WHERE stream_key=?",
        )
        .get(["youtube", video.id, kind, "primary"].join("|"));
      if (!known) storeStream(a, base(video, kind));
    }
  let processedVideos = 0;
  const priority = (video: VideoSource) => {
    const known = a.db
      .query<{ status: string }, [string]>(
        "SELECT status FROM streams WHERE stream_key=?",
      )
      .get(["youtube", video.id, "watch", "primary"].join("|"));
    return known?.status === "catalogued-not-playback-verified"
      ? 0
      : known?.status === "probe-failed"
        ? 1
        : 2;
  };
  for (const video of [...videos.values()]
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, budget)) {
    options.signal?.throwIfAborted();
    try {
      await probeYoutube(a, video, options.signal);
      processedVideos++;
    } catch (error) {
      a.db
        .query(
          "UPDATE streams SET status='probe-failed',evidence_json=? WHERE provider='youtube' AND provider_id=? AND kind IN ('watch','embed')",
        )
        .run(
          JSON.stringify({
            sourcePage: video.sourceUrl,
            scope: video.scope,
            probeError: String(error),
            playbackVerified: false,
          }),
          video.id,
        );
      errors.push({
        source: `https://www.youtube.com/watch?v=${video.id}`,
        error: String(error),
      });
    }
  }
  storeStream(a, {
    provider: "netflix",
    providerId: "70266998",
    kind: "catalogue",
    title: "Fairy Tail — Netflix",
    url: NETFLIX,
    sourceUrl: NETFLIX,
    language: "en",
    access: "subscription",
    status: "catalogued-not-playback-verified",
    evidence: {
      scope: "public title metadata; subscription playback not acquired",
    },
  });
  try {
    const resolved = obj(
        await aphrodyWeb(
          ["media", "resolve", NETFLIX, "--timeout-ms", "10000"],
          20000,
        ),
      ),
      candidates = Array.isArray(resolved.candidates)
        ? resolved.candidates.map(obj)
        : [];
    for (const candidate of candidates) {
      const kind = str(candidate.kind),
        url = str(candidate.url);
      if (!url || !["mp4", "hls", "dash"].includes(kind)) continue;
      const id = storeStream(a, {
        provider: "netflix",
        providerId: "70266998",
        kind: kind as StreamKind,
        title: "Fairy Tail — aperçu vidéo public Netflix",
        url,
        sourceUrl: NETFLIX,
        language: "und",
        access: "public",
        status: "observed-page-media",
        ephemeral: true,
        expiresAt: expiry(url, resolved.expiresAt),
        variant: new URL(url).pathname,
        evidence: {
          scope: "public-page-promotional-preview; not a full episode",
          owner: "aphrody web media resolve",
          rule: candidate.rule,
          confidence: candidate.confidence,
          playbackVerified: false,
        },
      });
      try {
        if (kind === "mp4") await probeMp4(a, id);
        else if (kind === "hls") await probeHls(a, id);
        else await probeDash(a, id);
      } catch (error) {
        errors.push({ source: "netflix-public-preview", error: String(error) });
        a.db
          .query("UPDATE streams SET status='probe-failed' WHERE id=?")
          .run(id);
      }
    }
  } catch (error) {
    errors.push({ source: NETFLIX, error: String(error) });
  }
  try {
    const fetched = obj(await aphrodyWeb(["fetch", TVTOKYO, "--json"], 20000));
    if (path(fetched, "transport", "status") === 200)
      storeStream(a, {
        provider: "tv-tokyo",
        providerId: "fairytail",
        kind: "catalogue",
        title: "Fairy Tail — TV Tokyo",
        url: TVTOKYO,
        sourceUrl: TVTOKYO,
        language: "ja",
        access: "unknown",
        status: "catalogued",
        evidence: {
          scope: "official programme metadata; no video manifest observed",
          httpStatus: 200,
        },
      });
  } catch (error) {
    errors.push({ source: TVTOKYO, error: String(error) });
  }
  return {
    processedVideos,
    discoveredVideos: videos.size,
    errors,
    catalog: streamCatalog(a, { limit: 200 }),
    exhaustive: false,
  };
}

type HlsOwner = {
  getHlsBrowserAssetPath: () => string;
  getHlsPublicAssets: () => Promise<{
    version: string;
    worker: string;
    license: string;
  }>;
};
async function resolveHlsPlayer() {
  const directory = resolve(
      Bun.env.BUN_VIDEO_ROOT ?? "C:/bun/packages/bun-video",
    ),
    modulePath = resolve(directory, "src/hls.ts").replaceAll("\\", "/");
  const url = new URL(
      `file://${modulePath.startsWith("/") ? "" : "/"}${modulePath}`,
    ),
    owner = (await import(url.href)) as HlsOwner;
  const metadata = await owner.getHlsPublicAssets(),
    files = {
      "hls.min.js": owner.getHlsBrowserAssetPath(),
      "hls.worker.js": metadata.worker,
      LICENSE: metadata.license,
    };
  for (const file of Object.values(files))
    if (Bun.file(file).size < 1) throw new Error("Asset HLS natif absent");
  return { version: metadata.version, files };
}
export async function getHlsPlayerAssets() {
  try {
    const owner = await resolveHlsPlayer();
    return {
      available: true,
      owner: "@aphrody/bun-video/hls",
      version: owner.version,
      license: "Apache-2.0",
      assets: {
        script: {
          url: "/streams/player/hls.min.js",
          mime: "application/javascript",
        },
        worker: {
          url: "/streams/player/hls.worker.js",
          mime: "application/javascript",
        },
        license: { url: "/streams/player/LICENSE", mime: "text/plain" },
      },
      qualification: {
        assetFilesVerified: true,
        browserPlaybackVerified: false,
        requiresMediaSource: true,
      },
    };
  } catch (error) {
    return {
      available: false,
      owner: "@aphrody/bun-video/hls",
      error: String(error),
      qualification: {
        assetFilesVerified: false,
        browserPlaybackVerified: false,
        requiresMediaSource: true,
      },
    };
  }
}
export async function hlsPlayerAssetResponse(
  name: string,
  headers?: Headers,
): Promise<Response> {
  if (!["hls.min.js", "hls.worker.js", "LICENSE"].includes(name))
    return Response.json({ error: "Asset HLS inconnu" }, { status: 404 });
  try {
    const owner = await resolveHlsPlayer(),
      file = Bun.file(owner.files[name as keyof typeof owner.files]),
      bytes = await file.bytes(),
      etag = `"${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}"`,
      responseHeaders = {
        "Content-Type":
          name === "LICENSE"
            ? "text/plain; charset=utf-8"
            : "application/javascript; charset=utf-8",
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
      headers: { ...responseHeaders, "Content-Length": String(file.size) },
    });
  } catch {
    return Response.json(
      { error: "Lecteur HLS natif indisponible; configurer BUN_VIDEO_ROOT" },
      { status: 503 },
    );
  }
}
