import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { buildIndex } from "../packages/search-index/index.ts";
import {
  callRagCore,
  nativeStatus,
  hybridSearch,
  sourceKind,
  exportCorpus,
} from "../packages/native-ai/index.ts";

async function failure(task: () => Promise<unknown>) {
  try {
    await task();
    return "";
  } catch (e) {
    return String(e);
  }
}

test("Native rag-core runs real RRF and rejects unknown operations and excessive inputs", async () => {
  const result = await callRagCore<{ id: number; score: number }[]>("rrf", {
    lists: [
      [1, 2],
      [2, 3],
    ],
  });
  expect(result[0]?.id).toBe(2);
  expect(new Set(result.map((hit) => hit.id)).size).toBe(3);
  expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  expect(
    (await failure(() => callRagCore("not_a_real_operation", {}))).length,
  ).toBeGreaterThan(0);
  expect(
    await failure(() =>
      callRagCore("measure", { text: "a".repeat(256 * 1024) }),
    ),
  ).toContain("256 Kio");
}, 30000);

test("Native capability status exposes linked ABI and keeps inventory separate from inference readiness", async () => {
  const status = await nativeStatus();
  expect(status.rag.available).toBe(true);
  expect(status.rag.abi).toBe(1);
  expect(status.rag.crate).toBe("aphrody-rag-core");
  expect(
    (status.rag.json as { name: string }[]).some(
      (op) => op.name === "rrf_weighted",
    ),
  ).toBe(true);
  expect(status.ai.runtimeReadiness).toBe("not_probed");
  expect(status.retrieval.neuralEmbeddings).toBe(false);
}, 30000);

test("Hybrid retrieval calls native fusion, applies Fairy Tail provenance and reports missing or stale vectors", async () => {
  const root = mkdtempSync(resolve("data/native-ai-test-")),
    archive = new Archive(":memory:");
  const indexPath = resolve(root, "corpus.index");
  try {
    archive.ingest(
      "https://fairytail.fandom.com/wiki/Natsu",
      "Natsu Wiki",
      "Natsu utilise la magie du feu.",
      "fr",
    );
    archive.ingest(
      "https://www.pika.fr/manga/fairy-tail",
      "Fairy Tail officiel",
      "Natsu utilise la magie du feu.",
      "fr",
    );
    archive.ingest(
      "https://ja.wikipedia.org/wiki/FAIRY_TAIL",
      "FAIRY TAIL",
      "ナツは火の魔法を使う魔導士です。",
      "ja",
    );
    const lexical = await hybridSearch(archive, "Natsu magie", {
      lang: "fr",
      limit: 2,
      indexPath,
    });
    expect(lexical.mode).toBe("lexical");
    expect(lexical.hits[0]?.sourceKind).toBe("official");
    expect(lexical.hits[1]?.sourceKind).toBe("wiki");
    expect(lexical.vectorError?.length).toBeGreaterThan(0);
    await buildIndex(archive, { path: indexPath });
    const hybrid = await hybridSearch(archive, "Natsu magie", {
      lang: "fr",
      limit: 2,
      indexPath,
    });
    expect(hybrid.mode).toBe("hybrid-lexical-hash");
    expect(hybrid.hits[0]?.sourceKind).toBe("official");
    expect(hybrid.hits.every((hit) => hit.language === "fr")).toBe(true);
    expect(
      (
        await hybridSearch(archive, "火の魔法", {
          lang: "ja",
          limit: 1,
          indexPath,
        })
      ).hits[0]?.language,
    ).toBe("ja");
    archive.ingest("local:lucy", "Lucy", "Lucy invoque des esprits.", "fr");
    const stale = await hybridSearch(archive, "Natsu", {
      lang: "fr",
      limit: 2,
      indexPath,
    });
    expect(stale.mode).toBe("lexical");
    expect(stale.vectorError).toContain("périmé");
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("Fairy Tail source attribution retains Fandom and avoids unrelated author or host claims", () => {
  expect(sourceKind("https://fairy-tail.fandom.com/fr/wiki/Natsu")).toBe(
    "wiki",
  );
  expect(sourceKind("https://x.com/hiro_mashima/status/1")).toBe("author");
  expect(sourceKind("https://x.com/unrelated/status/1")).toBe("other");
  expect(sourceKind("https://pika.fr.evil.test/page")).toBe("other");
  expect(sourceKind("https://fancaps.net/anime/episode.php?1")).toBe(
    "captures",
  );
});

test("Corpus export streams native Shenron documents while preserving URLs and Japanese text", async () => {
  const root = mkdtempSync(resolve("data/native-export-test-")),
    archive = new Archive(":memory:");
  try {
    archive.ingest(
      "https://fairytail.fandom.com/wiki/Natsu",
      "Natsu",
      "Natsu utilise la magie du feu.",
      "fr",
    );
    archive.ingest(
      "https://ja.wikipedia.org/wiki/FAIRY_TAIL",
      "ナツ",
      "ナツは火の魔法を使う。",
      "ja",
    );
    const exported = await exportCorpus(
      archive,
      resolve(root, "fairy-tail.jsonl"),
    );
    expect(exported.documents).toBe(2);
    const docs = (await Bun.file(exported.path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(docs[0].url).toBe("https://fairytail.fandom.com/wiki/Natsu");
    expect(docs[1].lang).toBe("ja");
    expect(docs[1].markdown).toBe("ナツは火の魔法を使う。");
    expect(docs[0].id).toBe("fairytail:document:1");
    expect(
      await failure(() => exportCorpus(archive, resolve(root, "wrong.sqlite"))),
    ).toContain(".jsonl");
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});
