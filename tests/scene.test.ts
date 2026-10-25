import { test, expect } from "bun:test";
import { mkdirSync, unlinkSync, realpathSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { initManga } from "../packages/manga/index.ts";
import {
  analyzePixels,
  contourSvg,
  buildScenes,
  sceneCatalog,
  sceneAssetResponse,
} from "../packages/scene/index.ts";

function bmp(variant = 0, blank = false) {
  const width = 64,
    height = 64,
    stride = Math.ceil((width * 3) / 4) * 4,
    data = new Uint8Array(54 + stride * height),
    view = new DataView(data.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, data.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = 54 + y * stride + x * 3,
        inside = x > 16 && x < 47 && y > 12 && y < 52;
      data[offset] = blank ? 0 : inside ? 240 : variant ? 255 - x * 3 : x * 3;
      data[offset + 1] = blank ? 0 : inside ? 100 : y * 3;
      data[offset + 2] = blank
        ? 0
        : inside
          ? variant
            ? 50
            : 220
          : 255 - y * 3;
    }
  return data;
}
async function source(archive: Archive, blank = false) {
  initManga(archive);
  mkdirSync("data/manga/cache", { recursive: true });
  const path = resolve(
      "data/manga/cache",
      `scene-test-${crypto.randomUUID()}.bmp`,
    ),
    bytes = bmp(0, blank),
    sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  await Bun.write(path, bytes);
  archive.db
    .query(
      "INSERT INTO manga_volumes(book_url,title,isbn13,state) VALUES(?,?,?,'ready')",
    )
    .run(
      "https://www.pika.fr/livre/fairy-tail-t01-9782845999145/",
      "Fairy Tail — scene test",
      "9782845999145",
    );
  const volume = archive.db
    .query<{ id: number }, []>("SELECT id FROM manga_volumes")
    .get()!;
  archive.db
    .query(
      "INSERT INTO manga_pages(volume_id,ordinal,document_path,text) VALUES(?,1,'test.xhtml','')",
    )
    .run(volume.id);
  const page = archive.db
    .query<{ id: number }, []>("SELECT id FROM manga_pages")
    .get()!;
  archive.db
    .query(
      "INSERT INTO manga_assets(page_id,ordinal,entry_path,declared_mime,source_url,cache_state,sha256,mime,bytes,width,height,cache_path) VALUES(?,1,'test.bmp','image/bmp',?,'cached',?,'image/bmp',?,64,64,?)",
    )
    .run(
      page.id,
      "https://extraits.tea-ebook.com/Hachette/6/12/9782811614126.epub",
      sha,
      bytes.length,
      path,
    );
  const asset = archive.db
    .query<{ id: number }, []>("SELECT id FROM manga_assets")
    .get()!;
  return { path, id: asset.id, sha };
}
function cleanupScene(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid test scene ID");
  const root = realpathSync(resolve("data/scenes")),
    target = realpathSync(resolve(root, id)),
    tail = relative(root, target);
  if (!tail || tail.startsWith("..") || isAbsolute(tail))
    throw new Error("Test cleanup escaped scene root");
  rmSync(target, { recursive: true, force: true });
}

test("Sobel contours are deterministic measurements of the input pixels", () => {
  const data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = x < 4 ? 0 : 255;
      data[i + 3] = 255;
    }
  const pixels = { width: 8, height: 8, channels: 4 as const, data },
    analysis = analyzePixels(pixels);
  expect(analysis.edges.length).toBeGreaterThan(0);
  expect(analysis.centroid.x).toBe(0.5);
  const first = contourSvg(pixels, 80, 80).svg;
  expect(first).toBe(contourSvg(pixels, 80, 80).svg);
  expect(first.includes('viewBox="0 0 8 8"')).toBe(true);
  expect(/<script|\bhref\s*=/i.test(first)).toBe(false);
});

test("native image scenes expose real textures, 3D plane geometry and unchanged source bytes", async () => {
  const archive = new Archive(":memory:"),
    fixture = await source(archive),
    ids: string[] = [];
  try {
    const scenes = await buildScenes(archive, { maxSources: 1 });
    expect(scenes).toHaveLength(1);
    const scene = scenes[0]!;
    ids.push(scene.id);
    expect(scene.reconstruction).toBe("layered-2.5d");
    expect(scene.analysis.neuralDepth).toBe(false);
    expect(scene.source.sha256).toBe(fixture.sha);
    expect(scene.source.scope).toBe("preview");
    expect(scene.analysis.edgeSegments).toBeGreaterThan(0);
    expect(scene.layers[1]!.position[2]).toBeGreaterThan(
      scene.layers[0]!.position[2],
    );
    expect(scene.camera.position[2]).toBeGreaterThan(
      scene.layers[2]!.position[2],
    );
    expect(scene.assets.texture.width).toBe(64);
    expect(
      new Bun.CryptoHasher("sha256")
        .update(await Bun.file(fixture.path).bytes())
        .digest("hex"),
    ).toBe(fixture.sha);
    const response = sceneAssetResponse(archive, scene.id, "texture.webp");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    const output = new Uint8Array(await response.arrayBuffer());
    expect(new Bun.CryptoHasher("sha256").update(output).digest("hex")).toBe(
      scene.assets.texture.sha256,
    );
    expect(
      sceneAssetResponse(
        archive,
        scene.id,
        "texture.webp",
        new Headers({ "If-None-Match": `"${scene.assets.texture.sha256}"` }),
      ).status,
    ).toBe(304);
    expect(
      sceneAssetResponse(archive, scene.id, "../../original.bmp").status,
    ).toBe(400);
    expect(
      sceneAssetResponse(archive, "not-a-scene", "texture.webp").status,
    ).toBe(400);
    expect(await buildScenes(archive, { maxSources: 1 })).toEqual(scenes);
    expect(sceneCatalog(archive)).toHaveLength(1);
    const replacement = bmp(1),
      replacementHash = new Bun.CryptoHasher("sha256")
        .update(replacement)
        .digest("hex");
    await Bun.write(fixture.path, replacement);
    archive.db
      .query("UPDATE manga_assets SET sha256=?,bytes=? WHERE id=?")
      .run(replacementHash, replacement.length, fixture.id);
    const rebuilt = await buildScenes(archive, { maxSources: 1 });
    expect(rebuilt).toHaveLength(1);
    ids.push(rebuilt[0]!.id);
    expect(rebuilt[0]!.id === scene.id).toBe(false);
    expect(sceneCatalog(archive)).toHaveLength(1);
    expect(sceneAssetResponse(archive, scene.id, "texture.webp").status).toBe(
      404,
    );
    archive.db.query("DELETE FROM manga_assets WHERE id=?").run(fixture.id);
    expect(sceneCatalog(archive)).toEqual([]);
    expect(
      sceneAssetResponse(archive, rebuilt[0]!.id, "texture.webp").status,
    ).toBe(404);
    expect(await buildScenes(archive, { maxSources: 1 })).toEqual([]);
    expect(archive.db.query("SELECT count(*) n FROM scenes").get()).toEqual({
      n: 0,
    });
    expect(
      archive.db.query("SELECT count(*) n FROM scene_assets").get(),
    ).toEqual({ n: 0 });
  } finally {
    archive.close();
    unlinkSync(fixture.path);
    for (const id of ids) cleanupScene(id);
  }
});

test("uniform black frames are excluded instead of invented as detailed scenes", async () => {
  const archive = new Archive(":memory:"),
    fixture = await source(archive, true);
  try {
    expect(await buildScenes(archive, { maxSources: 1 })).toEqual([]);
    expect(sceneCatalog(archive)).toEqual([]);
  } finally {
    archive.close();
    unlinkSync(fixture.path);
  }
});
