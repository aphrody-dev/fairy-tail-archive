import { mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { contained, indexEpisode } from "../video/index.ts";

type StreamRow = {
  id: number;
  provider: string;
  kind: string;
  url: string;
  source_url: string;
  access: string;
  status: string;
  mime: string | null;
  expires_at: string | null;
  evidence_json: string;
};
export type StreamImportOptions = {
  maxDownloadBytes?: number;
  maxDuration?: number;
  maxFrames?: number;
  maxOutputBytes?: number;
  mediaRoot?: string;
  outputRoot?: string;
  signal?: AbortSignal;
};
type LocalAsset = {
  stream_id: number;
  episode_id: string;
  path: string;
  sha256: string;
  bytes: number;
  kind: string;
};
const active = new Set<string>();
function init(a: Archive) {
  a.db.run(
    `CREATE TABLE IF NOT EXISTS stream_local_assets(stream_id INTEGER PRIMARY KEY REFERENCES streams(id),episode_id TEXT NOT NULL REFERENCES episodes(id),path TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind='promotional-preview'),source_url TEXT NOT NULL,provenance_json TEXT NOT NULL,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
}
function limit(
  value: number | undefined,
  fallback: number,
  ceiling: number,
  name: string,
) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > ceiling)
    throw new Error(`${name}: entier de 1 à ${ceiling}`);
  return result;
}
function registered(a: Archive, id: number): StreamRow {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("ID de flux positif requis");
  const row = a.db
    .query<StreamRow, [number]>("SELECT * FROM streams WHERE id=?")
    .get(id);
  if (!row) throw new Error("Flux absent du catalogue");
  const url = new URL(row.url),
    source = new URL(row.source_url),
    evidence = JSON.parse(row.evidence_json);
  if (
    row.kind !== "mp4" ||
    row.provider !== "netflix" ||
    row.access !== "public" ||
    row.status !== "media-header-verified" ||
    !/(?:^video\/mp4$|^application\/octet-stream$)/i.test(row.mime ?? "")
  )
    throw new Error("Seul un MP4 public vérifié est importable");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "nflxso.net" || url.hostname.endsWith(".nflxso.net")) ||
    source.href !== "https://www.netflix.com/title/70266998" ||
    !String(evidence.scope).startsWith("public-page-promotional-preview")
  )
    throw new Error("Origine promotionnelle enregistrée requise");
  const origin = a.db
    .query<{ origin: string }, [string, string, string]>(
      "SELECT origin FROM stream_origins WHERE origin=? AND provider=? AND source_url=?",
    )
    .get(url.origin, row.provider, row.source_url);
  if (!origin) throw new Error("Origine absente du registre");
  if (
    row.expires_at &&
    (!Number.isFinite(Date.parse(row.expires_at)) ||
      Date.parse(row.expires_at) <= Date.now())
  )
    throw new Error("Flux expiré");
  return row;
}
async function hashFile(path: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}
async function download(row: StreamRow, max: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30000);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? timeout.reason);
  signal?.throwIfAborted();
  signal?.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(row.url, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "video/mp4" },
    });
    if (response.status !== 200 || !response.body)
      throw new Error(`MP4 complet attendu : HTTP ${response.status}`);
    if (response.url && response.url !== row.url)
      throw new Error("URL de réponse différente du flux enregistré");
    if (
      !/^(?:video\/mp4|application\/octet-stream)(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new Error("MIME MP4 requis");
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > max))
      throw new Error("Téléchargement hors budget");
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > max) throw new Error("Téléchargement hors budget");
        parts.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    if (length && Number(length) !== size) throw new Error("MP4 tronqué");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (
      bytes.length < 12 ||
      new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
    )
      throw new Error("Signature MP4 ftyp absente");
    return bytes;
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", abort);
    timeout.removeEventListener("abort", abort);
  }
}

export async function importStream(
  a: Archive,
  id: number,
  options: StreamImportOptions = {},
) {
  if (!Bun.Video.available)
    throw new Error("Le fournisseur natif Bun.Video manque");
  const maxDownloadBytes = limit(
      options.maxDownloadBytes,
      16 * 1024 ** 2,
      64 * 1024 ** 2,
      "maxDownloadBytes",
    ),
    maxDuration = limit(options.maxDuration, 120, 600, "maxDuration"),
    maxFrames = limit(options.maxFrames, 3600, 18000, "maxFrames"),
    maxOutputBytes = limit(
      options.maxOutputBytes,
      2 * 1024 ** 3,
      8 * 1024 ** 3,
      "maxOutputBytes",
    );
  const row = registered(a, id),
    mediaRoot = resolve(options.mediaRoot ?? "data/media"),
    outputRoot = resolve(options.outputRoot ?? "data/frames"),
    key = `${mediaRoot}:${id}`;
  if (active.has(key)) throw new Error("Import de ce flux déjà en cours");
  active.add(key);
  let temporary: string | undefined;
  try {
    init(a);
    mkdirSync(mediaRoot, { recursive: true });
    const prior = a.db
      .query<LocalAsset, [number]>(
        "SELECT * FROM stream_local_assets WHERE stream_id=?",
      )
      .get(id);
    let path: string, sha256: string, bytes: number;
    if (prior) {
      path = contained(mediaRoot, prior.path);
      bytes = Bun.file(path).size;
      sha256 = await hashFile(path);
      if (sha256 !== prior.sha256 || bytes !== prior.bytes)
        throw new Error("Cache MP4 modifié");
      if (bytes > maxDownloadBytes) throw new Error("Cache MP4 hors budget");
    } else {
      const body = await download(row, maxDownloadBytes, options.signal);
      sha256 = new Bun.CryptoHasher("sha256").update(body).digest("hex");
      bytes = body.length;
      path = resolve(mediaRoot, `stream-${sha256}.mp4`);
      if (await Bun.file(path).exists()) {
        contained(mediaRoot, path);
        if ((await hashFile(path)) !== sha256)
          throw new Error("Cache MP4 existant différent");
      } else {
        temporary = resolve(mediaRoot, `.stream-${crypto.randomUUID()}.mp4`);
        await Bun.write(temporary, body);
        const metadata = await new Bun.Video(temporary).metadata();
        qualify(metadata, maxDuration, maxFrames);
        await Bun.write(path, body);
      }
    }
    const metadata = await new Bun.Video(path).metadata();
    qualify(metadata, maxDuration, maxFrames);
    // Register before frame extraction so an interrupted import resumes from the same bytes.
    const episodeId = sha256.slice(0, 24);
    a.db
      .query(
        "INSERT INTO episodes(id,path,fingerprint,metadata) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(episodeId, path, sha256, JSON.stringify(metadata));
    a.db
      .query(
        "INSERT INTO stream_local_assets(stream_id,episode_id,path,sha256,bytes,kind,source_url,provenance_json) VALUES(?,?,?,?,?,'promotional-preview',?,?) ON CONFLICT(stream_id) DO NOTHING",
      )
      .run(
        id,
        episodeId,
        path,
        sha256,
        bytes,
        row.source_url,
        JSON.stringify({
          scope: "promotional-preview",
          source: JSON.parse(row.evidence_json),
          decoder: "Bun.Video",
          fullEpisode: false,
        }),
      );
    const indexed = await indexEpisode(a, path, {
      mediaRoot,
      outputRoot,
      maxDuration,
      maxFrames,
      maxOutputBytes,
      batchSize: 4,
      signal: options.signal,
    });
    return {
      streamId: id,
      kind: "promotional-preview" as const,
      path,
      sha256,
      bytes,
      episodeId: indexed.id,
      frames: indexed.frames,
      encodedBytes: indexed.encodedBytes,
      metadata: indexed.metadata,
      sourceUrl: row.source_url,
    };
  } finally {
    if (temporary) unlinkSync(temporary);
    active.delete(key);
  }
}
function qualify(
  metadata: Bun.VideoMetadata,
  maxDuration: number,
  maxFrames: number,
) {
  if (!/^(?:h\.?264(?:\s*\([^)]*\))?|avc1|avc)$/i.test(metadata.codec))
    throw new Error(`Codec natif H264 requis : ${metadata.codec}`);
  if (
    !Number.isFinite(metadata.duration) ||
    metadata.duration <= 0 ||
    metadata.duration > maxDuration
  )
    throw new Error("Durée vidéo hors budget");
  if (
    !Number.isSafeInteger(metadata.frameCount) ||
    metadata.frameCount < 1 ||
    metadata.frameCount > maxFrames ||
    !Number.isSafeInteger(metadata.fpsNumerator) ||
    metadata.fpsNumerator < 1 ||
    !Number.isSafeInteger(metadata.fpsDenominator) ||
    metadata.fpsDenominator < 1 ||
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width * metadata.height > 4096 * 2160
  )
    throw new Error("Métadonnées vidéo hors budget");
}
export async function streamFileResponse(
  a: Archive,
  id: number,
  headers = new Headers(),
  mediaRoot = "data/media",
) {
  if (!Number.isSafeInteger(id) || id < 1)
    return new Response(null, { status: 404 });
  const table = a.db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='stream_local_assets'",
    )
    .get();
  if (!table) return new Response(null, { status: 404 });
  const row = a.db
    .query<LocalAsset, [number]>(
      "SELECT * FROM stream_local_assets WHERE stream_id=?",
    )
    .get(id);
  if (!row) return new Response(null, { status: 404 });
  try {
    const path = contained(resolve(mediaRoot), row.path),
      file = Bun.file(path);
    if (file.size !== row.bytes) return new Response(null, { status: 404 });
    const etag = `"${row.sha256}"`,
      result = new Headers({
        "Content-Type": "video/mp4",
        ETag: etag,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
      });
    if (headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers: result });
    return new Response(file, { headers: result });
  } catch {
    return new Response(null, { status: 404 });
  }
}
