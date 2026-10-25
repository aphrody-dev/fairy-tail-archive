import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import {
  buildIndex,
  searchIndex,
  indexStatus,
  lexicalVector,
} from "../packages/search-index/index.ts";

async function failure(task: () => Promise<unknown>) {
  try {
    await task();
    return "";
  } catch (e) {
    return String(e);
  }
}

test("Native vector index persists lexical chunks and applies language before top-k", async () => {
  const root = mkdtempSync(resolve("data/index-test-")),
    archive = new Archive(":memory:");
  const options = { path: resolve(root, "corpus.index") };
  try {
    archive.ingest(
      "local:natsu-fr",
      "Natsu Dragnir",
      "Natsu utilise la magie du feu.",
      "fr",
    );
    archive.ingest(
      "local:natsu-en",
      "Natsu Dragneel",
      "Natsu uses fire magic.",
      "en",
    );
    archive.ingest(
      "local:lucy-ja",
      "ルーシィ",
      "ルーシィは星霊魔導士です。",
      "ja",
    );
    const built = await buildIndex(archive, options);
    expect(built.entries).toBe(3);
    expect(built.corpusDigest).toHaveLength(64);
    expect((await indexStatus(archive, options)).ready).toBe(true);
    const hits = await searchIndex(archive, "Natsu fire", {
      ...options,
      lang: "fr",
      limit: 1,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe("local:natsu-fr");
    expect(hits[0]?.language).toBe("fr");
    expect(
      (
        await searchIndex(archive, "星霊魔導士", {
          ...options,
          lang: "ja",
          limit: 1,
        })
      )[0]?.url,
    ).toBe("local:lucy-ja");
    expect(
      await searchIndex(archive, "Natsu", { ...options, lang: "de" }),
    ).toEqual([]);
    expect(lexicalVector("Natsu FIRE")).toEqual(lexicalVector("natsu fire"));
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Index refuses absent and stale generations, rebuild removes old chunks", async () => {
  const root = mkdtempSync(resolve("data/index-stale-test-")),
    archive = new Archive(":memory:");
  const options = { path: resolve(root, "corpus.index") };
  try {
    expect((await indexStatus(archive, options)).ready).toBe(false);
    expect(
      await failure(() => searchIndex(archive, "Natsu", options)),
    ).toContain("absent");
    archive.ingest("local:natsu", "Natsu", "Natsu utilise le feu.", "fr");
    await buildIndex(archive, options);
    archive.ingest(
      "local:natsu",
      "Lucy",
      "Lucy invoque les esprits stellaires.",
      "fr",
    );
    expect(
      await failure(() => searchIndex(archive, "Natsu", options)),
    ).toContain("périmé");
    await buildIndex(archive, options);
    expect(
      (await searchIndex(archive, "Lucy esprits", options))[0]?.title,
    ).toBe("Lucy");
    const other = new Archive(":memory:");
    try {
      expect(
        await failure(() => searchIndex(other, "Lucy", options)),
      ).toContain("périmé");
    } finally {
      other.close();
    }
    unlinkSync(options.path);
    expect(
      await failure(() => searchIndex(archive, "Lucy", options)),
    ).toContain("absent");
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Index rejects corrupt binary, incompatible manifest and unsafe limits", async () => {
  const root = mkdtempSync(resolve("data/index-corrupt-test-")),
    archive = new Archive(":memory:");
  const options = { path: resolve(root, "corpus.index") };
  try {
    archive.ingest("local:natsu", "Natsu", "Natsu utilise le feu.", "fr");
    const manifest = await buildIndex(archive, options);
    await Bun.write(manifest.path, new Uint8Array([1, 2, 3]));
    expect(
      await failure(() => searchIndex(archive, "Natsu", options)),
    ).toContain("incohérents");
    await buildIndex(archive, options);
    const saved = (await Bun.file(manifest.manifestPath).json()) as Record<
      string,
      unknown
    >;
    await Bun.write(
      manifest.manifestPath,
      JSON.stringify({ ...saved, dimensions: 128 }),
    );
    expect(
      await failure(() => searchIndex(archive, "Natsu", options)),
    ).toContain("incompatible");
    expect(
      await failure(() =>
        searchIndex(archive, "Natsu", { ...options, limit: 100000 }),
      ),
    ).toContain("limit");
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Native index supports an empty corpus generation", async () => {
  const root = mkdtempSync(resolve("data/index-empty-test-")),
    archive = new Archive(":memory:");
  const options = { path: resolve(root, "corpus.index") };
  try {
    expect((await buildIndex(archive, options)).entries).toBe(0);
    expect(await searchIndex(archive, "Natsu", options)).toEqual([]);
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Persisted revision tracking detects a separate SQLite writer and source metadata changes", async () => {
  const root = mkdtempSync(resolve("data/index-writer-test-"));
  const path = resolve(root, "archive.sqlite"),
    archive = new Archive(path),
    options = { path: resolve(root, "corpus.index") };
  let other: Archive | undefined;
  try {
    archive.ingest("local:natsu", "Natsu", "Natsu utilise le feu.", "fr");
    await buildIndex(archive, options);
    other = new Archive(path);
    other.db
      .query("UPDATE documents SET title=? WHERE url=?")
      .run("Natsu Dragnir", "local:natsu");
    expect((await indexStatus(archive, options)).ready).toBe(false);
    expect(
      await failure(() => searchIndex(archive, "Natsu", options)),
    ).toContain("périmé");
    other.close();
    other = undefined;
    await buildIndex(archive, options);
    expect((await searchIndex(archive, "Natsu", options))[0]?.title).toBe(
      "Natsu Dragnir",
    );
  } finally {
    other?.close();
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});
