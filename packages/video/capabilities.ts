import { mkdirSync, unlinkSync } from "node:fs";
import * as fs from "node:fs";
import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { contained } from "./index.ts";

type NativeVideo = Bun.Video & {
  remux?: (path: string) => Promise<number>;
  hls?: (
    directory: string,
    options?: { segmentSeconds?: number },
  ) => Promise<number>;
  transcode?: unknown;
};
const runtimeRevision =
  (Bun as typeof Bun & { revision?: string }).revision ?? null;
// The project's minimal node:fs declarations omit this supported Bun compatibility API.
const linkSync = (
  fs as typeof fs & { linkSync(source: string, destination: string): void }
).linkSync;
export function mediaCapabilities() {
  const prototype = Bun.Video.prototype as NativeVideo;
  return {
    engine: "Bun.Video / FilmCraft",
    runtimeRevision,
    available: Bun.Video.available,
    formats: {
      conversionInputContainers: ["mp4"],
      conversionOutputContainers: ["mp4"],
      indexedFrames: "png",
      transcodeFormats: [],
    },
    operations: {
      probe: { available: Bun.Video.available },
      frames: { available: Bun.Video.available, rationalFrameRate: true },
      remux: {
        available: Bun.Video.available && typeof prototype.remux === "function",
        executionFormats: ["mp4"],
        reencodes: false,
        trackBoundary:
          "Fixture silent H264 qualified; the local Netflix H264+AAC preview is rejected by native remux with 'remux cannot preserve this track configuration'. No workaround or reencoding is applied.",
        qualification:
          "MP4 input/output signature, metadata and decoded frame checked by local fixture tests",
      },
      hls: {
        runtimeAvailable: typeof prototype.hls === "function",
        executionEnabled: false,
        documentation:
          "Native CMAF HLS exists in newer source documentation; unavailable in qualified runtime 169d8c5ea",
      },
      transcode: {
        runtimeAvailable: typeof prototype.transcode === "function",
        executionEnabled: false,
        reason: "No qualified native transcode API; no external encoder added",
      },
    },
    formatBoundary:
      "Only MP4 output is enabled. This runtime writes MP4 bytes for .mkv/.webm/.mov destinations; extensions alone are not format evidence.",
    playbackVerified: false,
  };
}
export type ConversionOptions = {
  operation?: "remux" | "hls" | "transcode";
  format?: string;
  mediaRoot?: string;
  outputRoot?: string;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxDuration?: number;
  maxFrames?: number;
};
function budget(
  value: number | undefined,
  fallback: number,
  max: number,
  name: string,
) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw new Error(`${name}: entier de 1 à ${max}`);
  return n;
}
async function hash(path: string) {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
}
export async function planMediaConversion(
  a: Archive,
  episodeId: string,
  options: ConversionOptions = {},
) {
  const capabilities = mediaCapabilities(),
    operation = options.operation ?? "remux",
    format = options.format ?? "mp4";
  if (operation !== "remux")
    throw new Error(
      `${operation}: opération native non qualifiée pour exécution dans ce runtime`,
    );
  if (format !== "mp4")
    throw new Error(
      "Seule la sortie MP4 a été qualifiée ; extension différente refusée",
    );
  if (!capabilities.operations.remux.available)
    throw new Error("Remux natif Bun.Video indisponible");
  const limits = {
    maxInputBytes: budget(
      options.maxInputBytes,
      16 * 1024 ** 2,
      64 * 1024 ** 2,
      "maxInputBytes",
    ),
    maxOutputBytes: budget(
      options.maxOutputBytes,
      32 * 1024 ** 2,
      128 * 1024 ** 2,
      "maxOutputBytes",
    ),
    maxDuration: budget(options.maxDuration, 120, 600, "maxDuration"),
    maxFrames: budget(options.maxFrames, 3600, 18000, "maxFrames"),
  };
  const row = a.db
    .query<{ id: string; path: string; fingerprint: string }, [string]>(
      "SELECT id,path,fingerprint FROM episodes WHERE id=?",
    )
    .get(episodeId);
  if (!row) throw new Error("Vidéo locale non enregistrée");
  const path = contained(resolve(options.mediaRoot ?? "data/media"), row.path),
    file = Bun.file(path);
  if (file.size < 12 || file.size > limits.maxInputBytes)
    throw new Error("Source vidéo hors budget");
  const signature = await file.slice(0, 12).bytes();
  if (new TextDecoder().decode(signature.subarray(4, 8)) !== "ftyp")
    throw new Error("Source MP4 ftyp requise");
  const fingerprint = await hash(path);
  if (fingerprint !== row.fingerprint)
    throw new Error("Source enregistrée modifiée");
  const metadata = await new Bun.Video(path).metadata();
  if (
    !Number.isFinite(metadata.duration) ||
    metadata.duration <= 0 ||
    metadata.duration > limits.maxDuration ||
    !Number.isSafeInteger(metadata.frameCount) ||
    metadata.frameCount < 1 ||
    metadata.frameCount > limits.maxFrames ||
    !Number.isSafeInteger(metadata.fpsNumerator) ||
    metadata.fpsNumerator < 1 ||
    !Number.isSafeInteger(metadata.fpsDenominator) ||
    metadata.fpsDenominator < 1
  )
    throw new Error("Métadonnées source hors budget");
  // MP4 remux has no native per-write output quota. Conservative preflight plus final-byte validation.
  if (file.size + 1024 * 1024 > limits.maxOutputBytes)
    throw new Error(
      "Budget sortie insuffisant pour le remux et sa marge de conteneur",
    );
  const table = a.db
    .query(
      "SELECT name FROM sqlite_master WHERE name='stream_local_assets' AND type='table'",
    )
    .get();
  const origin = table
    ? a.db
        .query<{ kind: string; source_url: string }, [string]>(
          "SELECT kind,source_url FROM stream_local_assets WHERE episode_id=? LIMIT 1",
        )
        .get(episodeId)
    : null;
  const source = {
    episodeId,
    path,
    sha256: fingerprint,
    bytes: file.size,
    scope: origin?.kind ?? "local-media",
    sourceUrl: origin?.source_url ?? null,
  };
  const outputRoot = resolve(options.outputRoot ?? "data/conversions");
  return {
    operation,
    format,
    engine: "Bun.Video.remux",
    reencodes: false,
    source,
    metadata,
    limits,
    outputRoot,
    outputPath: resolve(outputRoot, `${fingerprint}-remux.mp4`),
    runtimeRevision,
    playbackVerified: false,
  };
}
const running = new Set<string>();
export async function executeMediaConversion(
  a: Archive,
  episodeId: string,
  options: ConversionOptions = {},
) {
  const plan = await planMediaConversion(a, episodeId, options);
  if (running.has(plan.outputPath))
    throw new Error("Conversion de cette source déjà en cours");
  running.add(plan.outputPath);
  let temporary: string | undefined;
  try {
    mkdirSync(plan.outputRoot, { recursive: true });
    const receiptPath = `${plan.outputPath}.json`;
    if (await Bun.file(plan.outputPath).exists()) {
      contained(plan.outputRoot, plan.outputPath);
      if (!(await Bun.file(receiptPath).exists()))
        throw new Error("Sortie existante sans reçu : aucun écrasement");
      contained(plan.outputRoot, receiptPath);
      const receipt = (await Bun.file(receiptPath).json()) as {
        sourceSha256: string;
        sha256: string;
        bytes: number;
        metadata: Bun.VideoMetadata;
      };
      if (
        receipt.sourceSha256 !== plan.source.sha256 ||
        Bun.file(plan.outputPath).size !== receipt.bytes ||
        receipt.bytes > plan.limits.maxOutputBytes ||
        (await hash(plan.outputPath)) !== receipt.sha256
      )
        throw new Error("Sortie existante modifiée : aucun écrasement");
      return {
        ...plan,
        output: {
          path: plan.outputPath,
          bytes: receipt.bytes,
          sha256: receipt.sha256,
          metadata: receipt.metadata,
        },
        reused: true,
      };
    }
    if (await Bun.file(receiptPath).exists())
      throw new Error("Reçu existant sans sortie : aucun écrasement");
    temporary = resolve(plan.outputRoot, `.remux-${crypto.randomUUID()}.mp4`);
    await (new Bun.Video(plan.source.path) as NativeVideo).remux!(temporary);
    const file = Bun.file(temporary),
      signature = await file.slice(0, 12).bytes(),
      metadata = await new Bun.Video(temporary).metadata();
    if (
      file.size > plan.limits.maxOutputBytes ||
      new TextDecoder().decode(signature.subarray(4, 8)) !== "ftyp" ||
      metadata.frameCount !== plan.metadata.frameCount ||
      metadata.fpsNumerator !== plan.metadata.fpsNumerator ||
      metadata.fpsDenominator !== plan.metadata.fpsDenominator ||
      metadata.width !== plan.metadata.width ||
      metadata.height !== plan.metadata.height ||
      metadata.codec !== plan.metadata.codec ||
      Math.abs(metadata.duration - plan.metadata.duration) > 0.001
    )
      throw new Error("Qualification de sortie remux refusée");
    const sha256 = await hash(temporary),
      bytes = file.size;
    if ((await hash(plan.source.path)) !== plan.source.sha256)
      throw new Error("Source modifiée pendant le remux");
    // Hard-link publication is atomic and fails if another process already created the destination.
    linkSync(temporary, plan.outputPath);
    unlinkSync(temporary);
    temporary = undefined;
    await Bun.write(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          sourceSha256: plan.source.sha256,
          sha256,
          bytes,
          metadata,
          engine: plan.engine,
          runtimeRevision: plan.runtimeRevision,
          reencodes: false,
          createdAt: new Date().toISOString(),
          scope: plan.source.scope,
        },
        null,
        2,
      ),
    );
    return {
      ...plan,
      output: { path: plan.outputPath, bytes, sha256, metadata },
      reused: false,
    };
  } finally {
    if (temporary && (await Bun.file(temporary).exists()))
      unlinkSync(temporary);
    running.delete(plan.outputPath);
  }
}
