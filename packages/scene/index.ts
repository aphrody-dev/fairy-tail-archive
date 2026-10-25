import { mkdirSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { Archive } from "../archive/index.ts";

const ROOT = resolve("data/scenes"),
  VERSION = "bun-image-sobel-layered-v1";
const MAX_PIXELS = 16000000;
type Kind = "manga" | "anime" | "frame";
type Source = {
  kind: Kind;
  id: string;
  path: string;
  url: string;
  originalUrl: string | null;
  title: string;
  sha256: string;
  scope: "preview" | "thumbnail" | "local-frame";
};
export type SceneAsset = {
  url: string;
  mime: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
};
export type SceneDTO = {
  id: string;
  title: string;
  createdAt: string;
  reconstruction: "layered-2.5d";
  pipelineVersion: string;
  source: {
    kind: Kind;
    id: string;
    url: string;
    originalUrl: string | null;
    sha256: string;
    width: number;
    height: number;
    scope: Source["scope"];
  };
  width: number;
  height: number;
  aspect: number;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    near: number;
    far: number;
  };
  assets: {
    texture: SceneAsset;
    preview: SceneAsset;
    focus: SceneAsset;
    contours: SceneAsset;
    mask: SceneAsset;
  };
  layers: {
    id: string;
    geometry: "plane";
    width: number;
    height: number;
    position: [number, number, number];
    rotation: [number, number, number];
    texture: string;
    mask?: string;
    opacity: number;
  }[];
  analysis: {
    engine: string;
    sampleWidth: number;
    sampleHeight: number;
    edgeThreshold: number;
    edgeSegments: number;
    meanLuminance: number;
    luminanceVariance: number;
    crop: { left: number; top: number; width: number; height: number };
    maskMethod: string;
    neuralDepth: false;
  };
};
type Pixels = { width: number; height: number; channels: 4; data: Uint8Array };

function schema(archive: Archive) {
  archive.db
    .run(`CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,source_kind TEXT NOT NULL,source_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,pipeline_version TEXT NOT NULL,manifest_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(source_kind,source_id));
    CREATE TABLE IF NOT EXISTS scene_assets(scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,name TEXT NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,PRIMARY KEY(scene_id,name));`);
}
function exists(archive: Archive, table: string): boolean {
  return !!archive.db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(table);
}
function inside(path: string, root: string): string {
  const full = realpathSync(path),
    tail = relative(realpathSync(root), full);
  if (
    !tail ||
    tail === ".." ||
    tail.startsWith("../") ||
    tail.startsWith("..\\") ||
    isAbsolute(tail)
  )
    throw new Error("Chemin hors des assets locaux autorisés");
  return full;
}
function hash(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function sources(archive: Archive, limit: number): Source[] {
  const groups: Source[][] = [[], [], []];
  if (
    exists(archive, "manga_assets") &&
    exists(archive, "manga_pages") &&
    exists(archive, "manga_volumes")
  ) {
    const rows = archive.db
      .query<
        {
          id: number;
          cache_path: string;
          sha256: string;
          source_url: string;
          title: string;
          page: number;
        },
        [number]
      >(
        "SELECT a.id,a.cache_path,a.sha256,a.source_url,v.title,p.ordinal AS page FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id JOIN manga_volumes v ON v.id=p.volume_id WHERE a.cache_state='cached' AND a.cache_path IS NOT NULL ORDER BY a.id LIMIT ?",
      )
      .all(limit * 3);
    groups[0] = rows.map((r) => ({
      kind: "manga",
      id: String(r.id),
      path: r.cache_path,
      url: r.source_url,
      originalUrl: `/cdn/manga/${r.id}`,
      title: `${r.title} — extrait, page ${r.page}`,
      sha256: r.sha256,
      scope: "preview",
    }));
  }
  if (exists(archive, "fancaps_images")) {
    const rows = archive.db
      .query<
        {
          id: number;
          cache_path: string;
          sha256: string;
          picture_url: string;
          episode_id: number;
        },
        [number]
      >(
        "SELECT id,cache_path,sha256,picture_url,episode_id FROM fancaps_images WHERE cache_state='cached' AND cache_path IS NOT NULL AND bytes>512 ORDER BY id LIMIT ?",
      )
      .all(limit * 3);
    groups[1] = rows.map((r) => ({
      kind: "anime",
      id: String(r.id),
      path: r.cache_path,
      url: r.picture_url,
      originalUrl: `/cdn/fancaps/${r.id}`,
      title: `Fairy Tail — capture ${r.id}`,
      sha256: r.sha256,
      scope: "thumbnail",
    }));
  }
  if (exists(archive, "frames")) {
    const rows = archive.db
      .query<
        { episode_id: string; number: number; path: string; hash: string },
        [number]
      >(
        "SELECT episode_id,number,path,hash FROM frames ORDER BY episode_id,number LIMIT ?",
      )
      .all(limit * 3);
    groups[2] = rows.map((r) => ({
      kind: "frame",
      id: `${r.episode_id}:${r.number}`,
      path: r.path,
      url: `local:episode/${r.episode_id}/frame/${r.number}`,
      originalUrl: null,
      title: `Fairy Tail — image locale ${r.number}`,
      sha256: r.hash,
      scope: "local-frame",
    }));
  }
  const ordered: Source[] = [];
  for (let i = 0; i < limit * 3; i++)
    for (const group of groups) if (group[i]) ordered.push(group[i]!);
  return ordered;
}

export function analyzePixels(pixels: Pixels) {
  const { width, height, data } = pixels;
  if (
    width < 3 ||
    height < 3 ||
    width > 96 ||
    height > 96 ||
    data.length !== width * height * 4
  )
    throw new Error("Échantillon RGBA hors de la borne3..96 pixels");
  const luma = new Float64Array(width * height);
  let sum = 0,
    squared = 0;
  for (let i = 0; i < luma.length; i++) {
    const value =
      (data[i * 4]! * 0.2126 +
        data[i * 4 + 1]! * 0.7152 +
        data[i * 4 + 2]! * 0.0722) *
      (data[i * 4 + 3]! / 255);
    luma[i] = value;
    sum += value;
    squared += value * value;
  }
  const mean = sum / luma.length,
    variance = Math.max(0, squared / luma.length - mean * mean);
  const gradients: {
    x: number;
    y: number;
    gx: number;
    gy: number;
    magnitude: number;
  }[] = [];
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const value = (dx: number, dy: number) =>
        luma[(y + dy) * width + x + dx]!;
      const gx =
        -value(-1, -1) +
        value(1, -1) -
        2 * value(-1, 0) +
        2 * value(1, 0) -
        value(-1, 1) +
        value(1, 1);
      const gy =
        -value(-1, -1) -
        2 * value(0, -1) -
        value(1, -1) +
        value(-1, 1) +
        2 * value(0, 1) +
        value(1, 1);
      gradients.push({ x, y, gx, gy, magnitude: Math.hypot(gx, gy) });
    }
  const sorted = gradients.map((g) => g.magnitude).sort((a, b) => a - b);
  const threshold = Math.max(
    48,
    sorted[Math.floor(sorted.length * 0.82)] ?? 48,
  );
  const edges = gradients
    .filter((g) => g.magnitude >= threshold)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 2500);
  let energy = 0,
    cx = 0,
    cy = 0;
  for (const edge of edges) {
    energy += edge.magnitude;
    cx += (edge.x + 0.5) * edge.magnitude;
    cy += (edge.y + 0.5) * edge.magnitude;
  }
  return {
    width,
    height,
    luma,
    mean,
    variance,
    threshold,
    edges,
    centroid: {
      x: energy ? cx / energy / width : 0.5,
      y: energy ? cy / energy / height : 0.5,
    },
  };
}

export function contourSvg(
  pixels: Pixels,
  outputWidth: number,
  outputHeight: number,
) {
  const analysis = analyzePixels(pixels);
  const paths = analysis.edges
    .map((e) =>
      Math.abs(e.gx) > Math.abs(e.gy)
        ? `M${e.x + 0.5} ${e.y}v1`
        : `M${e.x} ${e.y + 0.5}h1`,
    )
    .join("");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${pixels.width} ${pixels.height}"><path d="${paths}" fill="none" stroke="#f5d7a3" stroke-width="0.3" stroke-linecap="round"/></svg>`,
    analysis,
  };
}
function maskSvg(pixels: Pixels, outputWidth: number, outputHeight: number) {
  const analysis = analyzePixels(pixels),
    rows: string[] = [];
  for (let y = 0; y < pixels.height; y++) {
    let start = -1,
      previous = 0;
    const emit = (end: number) => {
      if (start >= 0 && previous > 0)
        rows.push(
          `<rect x="${start}" y="${y}" width="${end - start}" height="1" fill="white" opacity="${previous}"/>`,
        );
    };
    for (let x = 0; x <= pixels.width; x++) {
      const contrast =
        x < pixels.width
          ? Math.abs(analysis.luma[y * pixels.width + x]! - analysis.mean) / 255
          : 0;
      const nx = (x + 0.5) / pixels.width - 0.5,
        ny = (y + 0.5) / pixels.height - 0.5;
      const envelope = Math.max(0, 1 - Math.sqrt(nx * nx * 2 + ny * ny * 2));
      const level =
        x < pixels.width
          ? Math.round(Math.min(1, (contrast * 0.75 + 0.28) * envelope) * 5) / 5
          : 0;
      if (level !== previous) {
        emit(x);
        start = x;
        previous = level;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${pixels.width} ${pixels.height}"><defs><filter id="soft"><feGaussianBlur stdDeviation="0.55"/></filter></defs><g filter="url(#soft)">${rows.join("")}</g></svg>`;
}

async function buildOne(
  archive: Archive,
  source: Source,
): Promise<SceneDTO | null> {
  const root =
    source.kind === "manga"
      ? resolve("data/manga/cache")
      : source.kind === "anime"
        ? resolve("data/fancaps/cache")
        : resolve("data/frames");
  const path = inside(source.path, root),
    file = Bun.file(path);
  if (file.size < 1 || file.size > 16 * 1024 * 1024)
    throw new Error("Source de scène hors de la borne1octet–16Mio");
  const sourceHash = hash(await file.bytes());
  if (sourceHash !== source.sha256) {
    archive.db
      .query("DELETE FROM scenes WHERE source_kind=? AND source_id=?")
      .run(source.kind, source.id);
    throw new Error(
      "Empreinte de source modifiée sans mise à jour du catalogue",
    );
  }
  const id = hash(`${VERSION}|${source.kind}|${source.id}|${sourceHash}`).slice(
    0,
    24,
  );
  const prior = archive.db
    .query<{ id: string; manifest_json: string }, [string, string]>(
      "SELECT id,manifest_json FROM scenes WHERE source_kind=? AND source_id=?",
    )
    .get(source.kind, source.id);
  if (prior?.id === id) {
    const assets = archive.db
      .query<{ path: string; bytes: number }, [string]>(
        "SELECT path,bytes FROM scene_assets WHERE scene_id=?",
      )
      .all(id);
    let valid = assets.length === 6;
    for (const asset of assets)
      try {
        if (Bun.file(inside(asset.path, ROOT)).size !== asset.bytes)
          valid = false;
      } catch {
        valid = false;
      }
    if (valid) return JSON.parse(prior.manifest_json) as SceneDTO;
  }
  if (prior) archive.db.query("DELETE FROM scenes WHERE id=?").run(prior.id);
  const metadata = await new Bun.Image(path, {
    maxPixels: MAX_PIXELS,
  }).metadata();
  if (
    metadata.width < 8 ||
    metadata.height < 8 ||
    metadata.width * metadata.height > MAX_PIXELS
  )
    throw new Error("Dimensions de scène non supportées");
  const sample = await new Bun.Image(path, { maxPixels: MAX_PIXELS })
    .resize(96, 96, { fit: "inside", withoutEnlargement: true })
    .rgba();
  const contour = contourSvg(sample, metadata.width, metadata.height),
    analysis = contour.analysis;
  if (analysis.variance < 12 || analysis.edges.length < 4) return null;
  const cropWidth = Math.max(1, Math.round(metadata.width * 0.72)),
    cropHeight = Math.max(1, Math.round(metadata.height * 0.72));
  const crop = {
    left: Math.max(
      0,
      Math.min(
        metadata.width - cropWidth,
        Math.round(analysis.centroid.x * metadata.width - cropWidth / 2),
      ),
    ),
    top: Math.max(
      0,
      Math.min(
        metadata.height - cropHeight,
        Math.round(analysis.centroid.y * metadata.height - cropHeight / 2),
      ),
    ),
    width: cropWidth,
    height: cropHeight,
  };
  const directory = resolve(ROOT, id);
  mkdirSync(directory, { recursive: true });
  const texture = await new Bun.Image(path, { maxPixels: MAX_PIXELS })
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .modulate({ brightness: 1.02, saturation: 1 })
    .webp({ lossless: true })
    .bytes();
  const preview = await new Bun.Image(path, { maxPixels: MAX_PIXELS })
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .bytes();
  const focus = await new Bun.Image(path, { maxPixels: MAX_PIXELS })
    .extract(crop)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .modulate({ brightness: 1.02, saturation: 1 })
    .webp({ lossless: true })
    .bytes();
  const focusPixels = await new Bun.Image(path, { maxPixels: MAX_PIXELS })
    .extract(crop)
    .resize(96, 96, { fit: "inside", withoutEnlargement: true })
    .rgba();
  const mask = maskSvg(focusPixels, crop.width, crop.height);
  const output: {
    name: string;
    data: Uint8Array | string;
    mime: string;
    width: number;
    height: number;
  }[] = [
    {
      name: "texture.webp",
      data: texture,
      mime: "image/webp",
      width: Math.min(
        metadata.width,
        Math.round(
          metadata.width *
            Math.min(1, 1280 / metadata.width, 1280 / metadata.height),
        ),
      ),
      height: Math.min(
        metadata.height,
        Math.round(
          metadata.height *
            Math.min(1, 1280 / metadata.width, 1280 / metadata.height),
        ),
      ),
    },
    {
      name: "preview.webp",
      data: preview,
      mime: "image/webp",
      width: Math.round(
        metadata.width *
          Math.min(1, 320 / metadata.width, 320 / metadata.height),
      ),
      height: Math.round(
        metadata.height *
          Math.min(1, 320 / metadata.width, 320 / metadata.height),
      ),
    },
    {
      name: "focus.webp",
      data: focus,
      mime: "image/webp",
      width: Math.round(
        crop.width * Math.min(1, 1024 / crop.width, 1024 / crop.height),
      ),
      height: Math.round(
        crop.height * Math.min(1, 1024 / crop.width, 1024 / crop.height),
      ),
    },
    {
      name: "contours.svg",
      data: contour.svg,
      mime: "image/svg+xml",
      width: metadata.width,
      height: metadata.height,
    },
    {
      name: "mask.svg",
      data: mask,
      mime: "image/svg+xml",
      width: crop.width,
      height: crop.height,
    },
  ];
  const rows: {
    name: string;
    path: string;
    sha256: string;
    mime: string;
    bytes: number;
    width: number;
    height: number;
  }[] = [];
  for (const asset of output) {
    const target = resolve(directory, asset.name);
    await Bun.write(target, asset.data);
    const measured =
      asset.mime === "image/webp"
        ? await new Bun.Image(target).metadata()
        : asset;
    rows.push({
      name: asset.name,
      path: target,
      sha256: hash(asset.data),
      mime: asset.mime,
      bytes:
        typeof asset.data === "string"
          ? new TextEncoder().encode(asset.data).byteLength
          : asset.data.byteLength,
      width: measured.width,
      height: measured.height,
    });
  }
  const descriptor = (name: string): SceneAsset => {
    const row = rows.find((r) => r.name === name)!;
    return {
      url: `/scenes/${id}/assets/${name}`,
      mime: row.mime,
      sha256: row.sha256,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
    };
  };
  const aspect = metadata.width / metadata.height;
  const assets = {
    texture: descriptor("texture.webp"),
    preview: descriptor("preview.webp"),
    focus: descriptor("focus.webp"),
    contours: descriptor("contours.svg"),
    mask: descriptor("mask.svg"),
  };
  const scene: SceneDTO = {
    id,
    title: source.title,
    createdAt: new Date().toISOString(),
    reconstruction: "layered-2.5d",
    pipelineVersion: VERSION,
    source: {
      kind: source.kind,
      id: source.id,
      url: source.url,
      originalUrl: source.originalUrl,
      sha256: sourceHash,
      width: metadata.width,
      height: metadata.height,
      scope: source.scope,
    },
    width: metadata.width,
    height: metadata.height,
    aspect,
    camera: {
      position: [0, 0, 3.6],
      target: [0, 0, 0],
      fov: 40,
      near: 0.1,
      far: 100,
    },
    assets,
    layers: [
      {
        id: "background",
        geometry: "plane",
        width: 2 * aspect,
        height: 2,
        position: [0, 0, -0.08],
        rotation: [0, 0, 0],
        texture: assets.texture.url,
        opacity: 1,
      },
      {
        id: "focus",
        geometry: "plane",
        width: (2 * aspect * crop.width) / metadata.width,
        height: (2 * crop.height) / metadata.height,
        position: [
          2 * aspect * ((crop.left + crop.width / 2) / metadata.width - 0.5),
          -2 * ((crop.top + crop.height / 2) / metadata.height - 0.5),
          0.05,
        ],
        rotation: [0, 0, 0],
        texture: assets.focus.url,
        mask: assets.mask.url,
        opacity: 0.9,
      },
      {
        id: "contours",
        geometry: "plane",
        width: 2 * aspect,
        height: 2,
        position: [0, 0, 0.1],
        rotation: [0, 0, 0],
        texture: assets.contours.url,
        opacity: 0.36,
      },
    ],
    analysis: {
      engine: "Bun.Image + deterministic Sobel",
      sampleWidth: sample.width,
      sampleHeight: sample.height,
      edgeThreshold: analysis.threshold,
      edgeSegments: analysis.edges.length,
      meanLuminance: analysis.mean,
      luminanceVariance: analysis.variance,
      crop,
      maskMethod: "contrast-weighted spatial cells; not semantic segmentation",
      neuralDepth: false,
    },
  };
  const manifest = JSON.stringify(scene, null, 2),
    manifestPath = resolve(directory, "manifest.json");
  await Bun.write(manifestPath, manifest);
  rows.push({
    name: "manifest.json",
    path: manifestPath,
    sha256: hash(manifest),
    mime: "application/json",
    bytes: new TextEncoder().encode(manifest).byteLength,
    width: 0,
    height: 0,
  });
  archive.db.transaction(() => {
    archive.db
      .query(
        "INSERT OR REPLACE INTO scenes(id,source_kind,source_id,source_sha256,pipeline_version,manifest_json) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        source.kind,
        source.id,
        sourceHash,
        VERSION,
        JSON.stringify(scene),
      );
    for (const row of rows)
      archive.db
        .query("INSERT INTO scene_assets VALUES(?,?,?,?,?,?,?,?)")
        .run(
          id,
          row.name,
          row.path,
          row.sha256,
          row.mime,
          row.bytes,
          row.width,
          row.height,
        );
  })();
  return scene;
}

function sourceCurrent(archive: Archive, scene: SceneDTO): boolean {
  const { kind, id, sha256 } = scene.source;
  if (kind === "manga" || kind === "anime") {
    const table = kind === "manga" ? "manga_assets" : "fancaps_images";
    return (
      exists(archive, table) &&
      !!archive.db
        .query(
          `SELECT 1 FROM ${table} WHERE id=? AND sha256=? AND cache_state='cached' AND cache_path IS NOT NULL`,
        )
        .get(id, sha256)
    );
  }
  if (kind === "frame" && exists(archive, "frames")) {
    const colon = id.lastIndexOf(":");
    return (
      colon > 0 &&
      !!archive.db
        .query(
          "SELECT 1 FROM frames WHERE episode_id=? AND number=? AND hash=?",
        )
        .get(id.slice(0, colon), Number(id.slice(colon + 1)), sha256)
    );
  }
  return false;
}

export async function buildScenes(
  archive: Archive,
  options: { maxSources?: number } = {},
): Promise<SceneDTO[]> {
  const budget = options.maxSources ?? 4;
  if (!Number.isInteger(budget) || budget < 1 || budget > 32)
    throw new Error("maxSources: entier de1à32");
  schema(archive);
  archive.db.transaction(() => {
    for (const row of archive.db
      .query<{ id: string; manifest_json: string }, []>(
        "SELECT id,manifest_json FROM scenes",
      )
      .all()) {
      if (!sourceCurrent(archive, JSON.parse(row.manifest_json) as SceneDTO))
        archive.db.query("DELETE FROM scenes WHERE id=?").run(row.id);
    }
  })();
  const result: SceneDTO[] = [];
  for (const source of sources(archive, budget)) {
    try {
      const scene = await buildOne(archive, source);
      if (scene) result.push(scene);
    } catch (error) {
      console.error(`Scene ${source.kind}:${source.id}: ${String(error)}`);
    }
    if (result.length >= budget) break;
  }
  return result;
}
export function sceneCatalog(archive: Archive): SceneDTO[] {
  if (!exists(archive, "scenes")) return [];
  return archive.db
    .query<{ manifest_json: string }, []>(
      "SELECT manifest_json FROM scenes ORDER BY created_at,id",
    )
    .all()
    .map((r) => JSON.parse(r.manifest_json) as SceneDTO)
    .filter((scene) => sourceCurrent(archive, scene));
}
export function sceneAssetResponse(
  archive: Archive,
  sceneId: string,
  assetName: string,
  headers?: Headers,
): Response {
  if (
    !/^[a-f0-9]{24}$/.test(sceneId) ||
    ![
      "texture.webp",
      "preview.webp",
      "focus.webp",
      "contours.svg",
      "mask.svg",
      "manifest.json",
    ].includes(assetName)
  )
    return Response.json({ error: "Asset de scène invalide" }, { status: 400 });
  if (!exists(archive, "scene_assets"))
    return Response.json({ error: "Scène non générée" }, { status: 404 });
  const scene = archive.db
    .query<{ manifest_json: string }, [string]>(
      "SELECT manifest_json FROM scenes WHERE id=?",
    )
    .get(sceneId);
  if (
    !scene ||
    !sourceCurrent(archive, JSON.parse(scene.manifest_json) as SceneDTO)
  )
    return Response.json({ error: "Source de scène périmée" }, { status: 404 });
  const asset = archive.db
    .query<
      { path: string; sha256: string; mime: string; bytes: number },
      [string, string]
    >(
      "SELECT path,sha256,mime,bytes FROM scene_assets WHERE scene_id=? AND name=?",
    )
    .get(sceneId, assetName);
  if (!asset)
    return Response.json({ error: "Asset de scène absent" }, { status: 404 });
  try {
    const path = inside(asset.path, resolve(ROOT, sceneId)),
      file = Bun.file(path);
    if (file.size !== asset.bytes)
      return Response.json(
        { error: "Asset de scène incomplet" },
        { status: 404 },
      );
    const etag = `"${asset.sha256}"`,
      responseHeaders = {
        "Content-Type": asset.mime,
        ETag: etag,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
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
      headers: { ...responseHeaders, "Content-Length": String(asset.bytes) },
    });
  } catch {
    return Response.json(
      { error: "Asset de scène inaccessible" },
      { status: 404 },
    );
  }
}
