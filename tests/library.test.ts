import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { initManga } from "../packages/manga/index.ts";
import {
  libraryOverview,
  listMangaVolumes,
  animeCatalog,
  wikiDocuments,
  getWikiDocument,
  readMangaPreview,
} from "../packages/library/index.ts";

test("Japanese previews without ISBN remain readable by stable volume ID", () => {
  const a = new Archive(":memory:");
  try {
    initManga(a);
    a.db.run(
      "INSERT INTO manga_volumes(id,book_url,title,language,reading_direction,scope,state) VALUES(999,'https://example.test/chapter','妖精の尻尾','ja','rtl','preview','ready')",
    );
    const result = readMangaPreview(a, 999);
    expect(result.volume?.id).toBe(999);
    expect(result.volume?.language).toBe("ja");
    expect(result.volume?.isbn13).toBe(null);
    expect(result.completeVolumeAvailable).toBe(false);
    let rejected = false;
    try {
      readMangaPreview(a, 0);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    a.close();
  }
});

test("library reads absent optional catalogues without creating tables or pretending completeness", async () => {
  const a = new Archive(":memory:");
  try {
    const before = a.db
      .query<{ n: number }, []>("SELECT count(*) n FROM sqlite_master")
      .get()!.n;
    expect(libraryOverview(a).coverage.exhaustive).toBe(false);
    expect(listMangaVolumes(a).items).toEqual([]);
    expect((await animeCatalog(a)).items).toEqual([]);
    expect(wikiDocuments(a).items).toEqual([]);
    expect(getWikiDocument(a, 1)).toBe(null);
    expect(readMangaPreview(a, "9782845999145").volume).toBe(null);
    expect(
      a.db
        .query<{ n: number }, []>("SELECT count(*) n FROM sqlite_master")
        .get()!.n,
    ).toBe(before);
  } finally {
    a.close();
  }
});

test("manga library joins catalogue ISBN and distinct preview EAN with explicit partial page counts", () => {
  const a = new Archive(":memory:");
  try {
    a.db
      .run(`CREATE TABLE catalog_books(url TEXT PRIMARY KEY,title TEXT,authors_json TEXT,isbn13 TEXT,published_on TEXT,synopsis TEXT,source_catalog_url TEXT,fetched_at TEXT,details_fetched_at TEXT);
      INSERT INTO catalog_books VALUES('https://www.pika.fr/livre/fairy-tail-t01/','Fairy Tail T01','["Hiro Mashima"]','9782845999145','2008-09-10','Une guilde de mages.','https://www.pika.fr/livres-fairy-tail/','2026-10-25',NULL);
      CREATE TABLE manga_volumes(id INTEGER PRIMARY KEY,book_url TEXT,title TEXT,isbn13 TEXT,preview_ean TEXT,preview_url TEXT,epub_url TEXT,scope TEXT,state TEXT);
      INSERT INTO manga_volumes VALUES(1,'https://www.pika.fr/livre/fairy-tail-t01/','Fairy Tail T01','9782845999145','9782811614126','https://www.liseuse-hachette.fr/ean/9782811614126','https://example.test/excerpt.epub','preview','ready');
      INSERT INTO manga_volumes VALUES(2,'https://www.pika.fr/livre/fairy-tail-t02/','Fairy Tail T02',NULL,NULL,NULL,NULL,'preview','unavailable');
      CREATE TABLE manga_pages(id INTEGER PRIMARY KEY,volume_id INTEGER,ordinal INTEGER);
      INSERT INTO manga_pages VALUES(1,1,1),(2,1,2),(3,1,3);
      CREATE TABLE manga_assets(id INTEGER PRIMARY KEY,page_id INTEGER,cache_state TEXT);
      INSERT INTO manga_assets VALUES(1,1,'cached'),(2,1,'cached'),(3,2,'cached'),(4,3,'pending'),(5,3,'cached');`);
    const result = listMangaVolumes(a, { limit: 1 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.isbn13).toBe("9782845999145");
    expect(result.items[0]?.previewEan).toBe("9782811614126");
    expect(result.items[0]?.availability.previewPages).toBe(3);
    expect(result.items[0]?.availability.cachedPreviewPages).toBe(2);
    expect(result.items[0]?.availability.previewAssets).toBe(5);
    expect(result.items[0]?.availability.cachedPreviewAssets).toBe(4);
    expect(result.items[0]?.availability.completeVolumeAvailable).toBe(false);
    expect(listMangaVolumes(a, { q: "9782845999145" }).total).toBe(1);
    expect(listMangaVolumes(a, { q: "%" }).total).toBe(0);
    expect(
      listMangaVolumes(a, { offset: 1 }).items[0]?.availability.catalogue,
    ).toBe(false);
    expect(libraryOverview(a).counts.mangaPreviewPages).toBe(3);
  } finally {
    a.close();
  }
});

test("anime library distinguishes linked files, missing indexed files and catalogue-only items", async () => {
  mkdirSync("data", { recursive: true });
  const root = mkdtempSync(resolve("data/library-test-"));
  if (relative(resolve("data"), root).startsWith(".."))
    throw new Error("Unsafe test cleanup path");
  const a = new Archive(":memory:");
  try {
    const local = resolve(root, "episode.mp4");
    await Bun.write(local, new Uint8Array([0, 0, 0, 1]));
    a.db
      .run(`CREATE TABLE media_catalog(provider TEXT,source_id TEXT,item_key TEXT,provider_id TEXT,title TEXT,url TEXT,episode_number INTEGER,season_number INTEGER,duration_seconds INTEGER,summary TEXT,audio_languages TEXT,subtitle_languages TEXT);
      INSERT INTO media_catalog VALUES('youtube','channel','one','abcdefghijk','Fairy Tail 1','https://example.test/1',1,1,1440,'Résumé','["fr"]','[]'),('youtube','channel','two','bcdefghijkl','Fairy Tail 2','https://example.test/2',2,1,1440,'Résumé','["fr"]','[]'),('netflix','show','three',NULL,'Fairy Tail 3','https://example.test/3',3,1,1440,'Résumé','["ja"]','["fr"]');
      CREATE TABLE media_local_links(provider TEXT,item_key TEXT,episode_id TEXT);
      INSERT INTO media_local_links VALUES('youtube','one','aaaaaaaaaaaaaaaaaaaaaaaa'),('youtube','two','bbbbbbbbbbbbbbbbbbbbbbbb');`);
    a.db
      .query(
        "INSERT INTO episodes(id,path,fingerprint,metadata,status) VALUES(?,?,?,?,?)",
      )
      .run("aaaaaaaaaaaaaaaaaaaaaaaa", local, "hash1", "{}", "complete");
    a.db
      .query(
        "INSERT INTO episodes(id,path,fingerprint,metadata,status) VALUES(?,?,?,?,?)",
      )
      .run(
        "bbbbbbbbbbbbbbbbbbbbbbbb",
        resolve(root, "missing.mp4"),
        "hash2",
        "{}",
        "interrupted",
      );
    a.db
      .query("INSERT INTO frames VALUES(?,?,?,?,?)")
      .run("aaaaaaaaaaaaaaaaaaaaaaaa", 0, 0, "frame.png", "framehash");
    const result = await animeCatalog(a, { provider: "youtube" });
    expect(result.total).toBe(2);
    expect(result.items[0]?.availability).toBe("local-file");
    expect(result.items[0]?.localVideoUrl).toBe(
      "/episodes/aaaaaaaaaaaaaaaaaaaaaaaa/video",
    );
    expect(result.items[0]?.indexedFrames).toBe(1);
    expect(result.items[1]?.availability).toBe("indexed-file-missing");
    expect(result.items[1]?.localVideoUrl).toBe(null);
    expect(
      (await animeCatalog(a, { provider: "netflix" })).items[0]?.availability,
    ).toBe("catalogue-only");
    expect((await animeCatalog(a, { q: "Tail 2", limit: 1 })).total).toBe(1);
    expect(
      result.items.every((item) => item.remotePlaybackAcquired === false),
    ).toBe(true);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki library preserves source revisions, filters languages and reads bounded source text", () => {
  const a = new Archive(":memory:");
  try {
    const id = a.ingest(
      "https://fairy-tail.fandom.com/fr/wiki/Natsu_Dragnir",
      "Natsu Dragnir",
      "**Natsu** est un mage du feu.",
      "fr",
    );
    a.ingest(
      "https://ja.wikipedia.org/wiki/FAIRY_TAIL",
      "FAIRY TAIL",
      "ナツは魔導士です。",
      "ja",
    );
    const publisher = a.ingest(
      "https://www.pika.fr/livre/fairy-tail/",
      "Fairy Tail T01",
      "Un volume de manga.",
      "fr",
    );
    a.db.run(
      "CREATE TABLE wiki_provenance(url TEXT PRIMARY KEY,revid INTEGER,page_id INTEGER,imported_at TEXT)",
    );
    a.db
      .query("INSERT INTO wiki_provenance VALUES(?,?,?,?)")
      .run(
        "https://fairy-tail.fandom.com/fr/wiki/Natsu_Dragnir",
        42,
        123,
        "2026-10-25",
      );
    expect(wikiDocuments(a).total).toBe(2);
    expect(wikiDocuments(a, { lang: "ja" }).items[0]?.language).toBe("ja");
    const search = wikiDocuments(a, { q: "Natsu", lang: "fr" });
    expect(search.items[0]?.revision).toBe(42);
    expect(search.totalIsExact).toBe(false);
    expect(search.searchWindow).toBe(50);
    const document = getWikiDocument(a, id, { maxCharacters: 9 });
    expect(document?.text).toBe("**Natsu**");
    expect(document?.truncated).toBe(true);
    expect(document?.origin).toBe("https://fairy-tail.fandom.com");
    expect(getWikiDocument(a, publisher)).toBe(null);
  } finally {
    a.close();
  }
});

test("library query parameters reject unsafe unbounded requests", async () => {
  const a = new Archive(":memory:");
  try {
    for (const operation of [
      () => listMangaVolumes(a, { limit: 101 }),
      () => wikiDocuments(a, { offset: -1 }),
      () => wikiDocuments(a, { lang: "unexpected" }),
      () => getWikiDocument(a, 0),
      () => getWikiDocument(a, 1, { maxCharacters: 100001 }),
    ]) {
      let rejected = false;
      try {
        operation();
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    }
    let rejected = false;
    try {
      await animeCatalog(a, { provider: "other" });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    a.close();
  }
});
