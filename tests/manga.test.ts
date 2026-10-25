import { test, expect } from "bun:test";
import { mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Python } from "bun:python";
import { Archive } from "../packages/archive/index.ts";
import {
  publicPreviewLink,
  inspectEpub,
  initManga,
  storeMangaManifest,
  mangaStatus,
  cacheMangaPage,
  mangaImageResponse,
  mangaPackageResponse,
} from "../packages/manga/index.ts";

const EAN = "9782811614126",
  ISBN = "9782845999145";
const previewUrl = `https://www.liseuse-hachette.fr/ean/${EAN}`;
const epubUrl = `https://extraits.tea-ebook.com/Hachette/6/12/${EAN}.epub`;
const bookUrl = `https://www.pika.fr/livre/fairy-tail-t01-${ISBN}/`;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/4cAAAAASUVORK5CYII=";

async function fixture(kind = "normal") {
  mkdirSync("data/manga/epub", { recursive: true });
  const path = resolve("data/manga/epub", `test-${crypto.randomUUID()}.epub`);
  await using py = await Python.async();
  await py.run(
    `import json as _ft_fixture_json\n_ft_fixture_payload=_ft_fixture_json.loads(${JSON.stringify(JSON.stringify({ path, kind, png }))})`,
  );
  await py.run(String.raw`
import zipfile as _ft_fixture_zip, base64 as _ft_fixture_b64
with _ft_fixture_zip.ZipFile(_ft_fixture_payload['path'],'w',compression=_ft_fixture_zip.ZIP_DEFLATED) as z:
    z.writestr('mimetype','application/epub+zip')
    z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>')
    package='<package><metadata><title>Fairy Tail test preview</title><language>fr</language></metadata><manifest><item id="p2" href="Content/p2.xhtml" media-type="application/xhtml+xml"/><item id="p10" href="Content/p10.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Image/page.png" media-type="image/png"/></manifest><spine page-progression-direction="rtl"><itemref idref="p2"/><itemref idref="p10"/></spine></package>'
    if _ft_fixture_payload['kind']=='shortened':
        package=package.replace('<itemref idref="p10"/>','')
    z.writestr('EPUB/package.opf',package)
    z.writestr('EPUB/Content/p2.xhtml','<html><body><img src="../Image/page.png"/></body></html>')
    z.writestr('EPUB/Content/p10.xhtml','<html><body>Une ligne de texte réellement présente.<img src="../Image/page.png"/></body></html>')
    z.writestr('EPUB/Image/page.png',_ft_fixture_b64.b64decode(_ft_fixture_payload['png']))
    if _ft_fixture_payload['kind']=='traversal':
        z.writestr('../escape.jpg','no')
    if _ft_fixture_payload['kind']=='oversized':
        z.writestr('EPUB/Image/oversized.jpg',b'x'*8388609)
    if _ft_fixture_payload['kind']=='encrypted':
        z.writestr('META-INF/encryption.xml','<encryption/>')
`);
  return path;
}

test("Pika preview EAN remains distinct from the printed ISBN", () => {
  expect(publicPreviewLink(`[visibilityFeuilleter](${previewUrl})`)).toEqual({
    url: previewUrl,
    ean: EAN,
  });
  expect(
    publicPreviewLink("[Feuilleter](https://evil.test/ean/9782811614126)"),
  ).toBe(null);
  expect(
    publicPreviewLink(
      "[Feuilleter](https://www.liseuse-hachette.fr/ean/9782811614126?redirect=elsewhere)",
    ),
  ).toBe(null);
});

test("EPUB pages follow the manifest spine, retain real text and do not invent OCR", async () => {
  const path = await fixture();
  try {
    const manifest = await inspectEpub(path);
    expect(manifest.pages).toHaveLength(2);
    expect(manifest.readingDirection).toBe("rtl");
    expect(manifest.pages[0]?.documentPath).toBe("EPUB/Content/p2.xhtml");
    expect(manifest.pages[0]?.text).toBe("");
    expect(manifest.pages[1]?.text).toBe(
      "Une ligne de texte réellement présente.",
    );
    expect(manifest.pages[0]?.assets[0]?.entryPath).toBe("EPUB/Image/page.png");
  } finally {
    unlinkSync(path);
  }
});

test("EPUB rejects path escapes, oversized expanded entries and encryption metadata", async () => {
  for (const kind of ["traversal", "oversized", "encrypted"]) {
    const path = await fixture(kind);
    try {
      let rejected = false;
      try {
        await inspectEpub(path);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      unlinkSync(path);
    }
  }
});

test("manga DB, image cache and EPUB streaming preserve provenance and exact bytes", async () => {
  const path = await fixture(),
    archive = new Archive(":memory:");
  let cachedPath: string | undefined;
  let secondPath: string | undefined;
  try {
    archive.db.run(
      "CREATE TABLE catalog_books(url TEXT PRIMARY KEY,title TEXT,isbn13 TEXT)",
    );
    archive.db
      .query("INSERT INTO catalog_books VALUES(?,?,?)")
      .run(bookUrl, "Fairy Tail T01", ISBN);
    initManga(archive);
    const volume = archive.db
      .query<{ id: number }, []>("SELECT id FROM manga_volumes")
      .get()!;
    const manifest = await inspectEpub(path),
      bytes = await Bun.file(path).bytes(),
      hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const source = {
      previewUrl,
      previewEan: EAN,
      epubUrl,
      packagePath: path,
      packageHash: hash,
      provenance: { kind: "test" },
    };
    storeMangaManifest(archive, volume.id, manifest, source);
    storeMangaManifest(archive, volume.id, manifest, source);
    const status = mangaStatus(archive, { isbn: ISBN });
    expect(status.counts.pages).toBe(2);
    expect(status.volumes[0]?.preview_ean).toBe(EAN);
    expect(status.volumes[0]?.isbn13).toBe(ISBN);
    const id = Number(status.pages[0]?.assets[0]?.id);
    expect(mangaImageResponse(archive, id).status).toBe(404);
    const cached = await cacheMangaPage(archive, id);
    storeMangaManifest(archive, volume.id, manifest, source);
    expect(mangaStatus(archive).counts.cachedAssets).toBe(1);
    cachedPath = archive.db
      .query<{ cache_path: string }, [number]>(
        "SELECT cache_path FROM manga_assets WHERE id=?",
      )
      .get(id)!.cache_path;
    const response = mangaImageResponse(archive, id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, no-cache");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
    );
    expect(
      mangaImageResponse(
        archive,
        id,
        new Headers({ "If-None-Match": `"${cached.sha256}"` }),
      ).status,
    ).toBe(304);
    expect(
      new Uint8Array(await mangaPackageResponse(archive, ISBN).arrayBuffer()),
    ).toEqual(bytes);
    expect(mangaPackageResponse(archive, "../../../private").status).toBe(400);
    expect(mangaImageResponse(archive, -1).status).toBe(400);
    secondPath = await fixture("shortened");
    const shortened = await inspectEpub(secondPath);
    const replacementHash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(secondPath).bytes())
      .digest("hex");
    expect(replacementHash === hash).toBe(false);
    storeMangaManifest(archive, volume.id, shortened, {
      ...source,
      packagePath: secondPath,
      packageHash: replacementHash,
    });
    const replacement = mangaStatus(archive);
    expect(replacement.counts.pages).toBe(1);
    expect(replacement.counts.assets).toBe(1);
    expect(replacement.counts.cachedAssets).toBe(0);
    expect(mangaImageResponse(archive, id).status).toBe(404);
  } finally {
    archive.close();
    unlinkSync(path);
    if (secondPath) unlinkSync(secondPath);
    if (cachedPath)
      try {
        unlinkSync(cachedPath);
      } catch {
        /*already absent*/
      }
  }
});
