import { mkdirSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { Archive } from "../archive/index.ts";

export function contained(root: string, path: string) {
  const result = relative(realpathSync(root), realpathSync(path));
  if (
    result === ".." ||
    result.startsWith("../") ||
    result.startsWith("..\\") ||
    isAbsolute(result)
  )
    throw new Error("Fichier hors du dossier média");
  return realpathSync(path);
}

export type EpisodeIndexOptions = {
  mediaRoot?: string;
  outputRoot?: string;
  batchSize?: number;
  signal?: AbortSignal;
  maxDuration?: number;
  maxFrames?: number;
  maxOutputBytes?: number;
};
const indexing = new Set<string>();
export async function indexEpisode(
  archive: Archive,
  input: string,
  options: EpisodeIndexOptions = {},
) {
  const path = contained(options.mediaRoot ?? "data/media", resolve(input));
  if (indexing.has(path))
    throw new Error("Indexation de cette vidéo déjà en cours");
  indexing.add(path);
  try {
    return await indexEpisodeUnlocked(archive, path, options);
  } finally {
    indexing.delete(path);
  }
}
async function indexEpisodeUnlocked(
  archive: Archive,
  input: string,
  options: EpisodeIndexOptions,
) {
  if (!Bun.Video.available)
    throw new Error("Le fournisseur natif Bun.Video manque");
  const path = contained(options.mediaRoot ?? "data/media", resolve(input));
  const file = Bun.file(path);
  // Streaming hash avoids loading an entire movie into memory.
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const part of file.stream()) hasher.update(part);
  const fingerprint = hasher.digest("hex");
  const id = fingerprint.slice(0, 24);
  const video = new Bun.Video(path),
    metadata = await video.metadata();
  const { fpsNumerator: n, fpsDenominator: d, frameCount } = metadata;
  if (!(n > 0 && d > 0 && frameCount > 0))
    throw new Error("Cadence ou nombre d'images invalide");
  for (const [name, value] of Object.entries({
    maxDuration: options.maxDuration,
    maxFrames: options.maxFrames,
    maxOutputBytes: options.maxOutputBytes,
  }))
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      throw new Error(`${name}: limite positive requise`);
  if (
    options.maxDuration !== undefined &&
    metadata.duration > options.maxDuration
  )
    throw new Error("Durée vidéo hors budget");
  if (options.maxFrames !== undefined && frameCount > options.maxFrames)
    throw new Error("Nombre d'images hors budget");
  if (
    !Number.isSafeInteger(frameCount) ||
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(d) ||
    !Number.isFinite(metadata.duration) ||
    metadata.duration <= 0
  )
    throw new Error("Métadonnées vidéo invalides");
  const batchSize = options.batchSize ?? 8;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64)
    throw new Error("batchSize: entier de 1 à 64");
  const outputRoot = resolve(options.outputRoot ?? "data/frames");
  const output = resolve(outputRoot, id);
  mkdirSync(output, { recursive: true });
  contained(outputRoot, output);
  archive.db
    .query(
      "INSERT INTO episodes(id,path,fingerprint,metadata) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path",
    )
    .run(id, path, fingerprint, JSON.stringify(metadata));
  let next = archive.db
    .query<{ next_frame: number }, [string]>(
      "SELECT next_frame FROM episodes WHERE id=?",
    )
    .get(id)!.next_frame;
  let encodedBytes = 0;
  try {
    const prior = archive.db
      .query<{ number: number; path: string; hash: string }, [string]>(
        "SELECT number,path,hash FROM frames WHERE episode_id=? ORDER BY number",
      )
      .all(id);
    if (prior.length !== next || prior.some((row, i) => row.number !== i))
      throw new Error("Reprise incohérente : images non contiguës");
    for (const row of prior) {
      const previous = Bun.file(contained(output, row.path));
      const hash = new Bun.CryptoHasher("sha256");
      for await (const chunk of previous.stream()) hash.update(chunk);
      if (hash.digest("hex") !== row.hash)
        throw new Error("Image de reprise modifiée");
      encodedBytes += previous.size;
    }
    if (
      options.maxOutputBytes !== undefined &&
      encodedBytes > options.maxOutputBytes
    )
      throw new Error("Images existantes hors budget");
  } catch (error) {
    archive.db
      .query("UPDATE episodes SET status='interrupted' WHERE id=?")
      .run(id);
    throw error;
  }
  archive.db.query("UPDATE episodes SET status='running' WHERE id=?").run(id);
  try {
    while (next < frameCount) {
      options.signal?.throwIfAborted();
      const count = Math.min(batchSize, frameCount - next);
      const frames = await video.frames({
        start: (next * d) / n,
        end: ((next + count) * d) / n,
        step: d / n,
        maxFrames: count,
      });
      if (frames.length !== count)
        throw new Error(
          `Décodage incomplet à l'image ${next}: ${frames.length}/${count}`,
        );
      const batchBytes = frames.reduce(
        (sum, frame) => sum + frame.bytes.byteLength,
        0,
      );
      if (
        options.maxOutputBytes !== undefined &&
        encodedBytes + batchBytes > options.maxOutputBytes
      )
        throw new Error("Images encodées hors budget");
      const rows: {
        number: number;
        time: number;
        path: string;
        hash: string;
      }[] = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!,
          number = next + i,
          target = resolve(output, `${String(number).padStart(8, "0")}.png`);
        const hash = new Bun.CryptoHasher("sha256")
          .update(frame.bytes)
          .digest("hex");
        const existing = Bun.file(target);
        if (await existing.exists()) {
          contained(output, target);
          const existingHash = new Bun.CryptoHasher("sha256");
          for await (const chunk of existing.stream())
            existingHash.update(chunk);
          if (existingHash.digest("hex") !== hash)
            throw new Error("Refus d'écraser une image existante différente");
        } else await Bun.write(target, frame.bytes);
        rows.push({
          number,
          time: frame.time,
          path: target,
          hash,
        });
      }
      archive.db.transaction(() => {
        for (const row of rows)
          archive.db
            .query("INSERT OR REPLACE INTO frames VALUES(?,?,?,?,?)")
            .run(id, row.number, row.time, row.path, row.hash);
        archive.db
          .query("UPDATE episodes SET next_frame=? WHERE id=?")
          .run(next + count, id);
      })();
      next += count;
      encodedBytes += batchBytes;
    }
    archive.db
      .query("UPDATE episodes SET status='complete' WHERE id=?")
      .run(id);
    return { id, frames: next, metadata, encodedBytes };
  } catch (error) {
    archive.db
      .query("UPDATE episodes SET status='interrupted' WHERE id=?")
      .run(id);
    throw error;
  }
}
