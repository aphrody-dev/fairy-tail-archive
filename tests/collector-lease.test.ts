import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive, withCollectorLease } from "../packages/archive/index.ts";
import { crawlWiki } from "../packages/crawler/wiki.ts";
import { collectFancaps, initFancaps } from "../packages/video/fancaps.ts";

async function rejects(action: () => unknown, message: string) {
  let error = "";
  try {
    await action();
  } catch (caught) {
    error = String(caught);
  }
  expect(error.includes(message)).toBe(true);
}

test("separate SQLite connections exclude collectors and stale owners cannot release replacements", async () => {
  const dir = mkdtempSync(resolve("data/lease-test-"));
  const a = new Archive(resolve(dir, "archive.sqlite")),
    b = new Archive(resolve(dir, "archive.sqlite"));
  let release!: () => void;
  const blocked = new Promise<void>((done) => {
    release = done;
  });
  let staleCheck!: () => void;
  const first = withCollectorLease(a, "fixture", async (check) => {
    staleCheck = check;
    await blocked;
  });
  const firstRejected = rejects(() => first, "lease lost");
  try {
    await rejects(
      () =>
        withCollectorLease(b, "fixture", async () => {
          throw new Error("must never run");
        }),
      "already running",
    );
    a.db.run("UPDATE collector_leases SET expires_at=0 WHERE name='fixture'");
    await withCollectorLease(b, "fixture", async (check) => {
      await rejects(staleCheck, "lease lost");
      release();
      await firstRejected;
      check();
      expect(
        b.db.query("SELECT count(*) n FROM collector_leases").get(),
      ).toEqual({ n: 1 });
    });
    expect(a.db.query("SELECT count(*) n FROM collector_leases").get()).toEqual(
      { n: 0 },
    );
  } finally {
    release();
    await firstRejected;
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an expired wiki worker cannot publish a late network response", async () => {
  const dir = mkdtempSync(resolve("data/lease-wiki-test-")),
    a = new Archive(":memory:");
  const origin = "https://fairy-tail.fandom.com/fr/wiki/";
  a.ingest(`${origin}Natsu`, "Natsu", "[[Lucy]]", "fr");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const first = crawlWiki(a, {
    sourceIds: ["fandom-fr"],
    maxPages: 1,
    outputRoot: dir,
    delayMs: 0,
    run: async (args) => {
      entered();
      await gate;
      return { url: args[3], titre: "Lucy", markdown: "Lucy est une mage." };
    },
  });
  const rejected = rejects(() => first, "lease lost");
  try {
    await started;
    await rejects(
      () => crawlWiki(a, { sourceIds: ["fandom-fr"] }),
      "already running",
    );
    a.db.run("UPDATE collector_leases SET expires_at=0");
    await withCollectorLease(a, "wiki:fandom-fr", async () => {
      release();
      await rejected;
      expect(a.stats().documents).toBe(1);
      expect(
        a.db
          .query("SELECT state FROM wiki_jobs WHERE url=?")
          .get(`${origin}Lucy`),
      ).toEqual({ state: "running" });
    });
    const recovered = await crawlWiki(a, {
      sourceIds: ["fandom-fr"],
      maxPages: 1,
      outputRoot: dir,
      delayMs: 0,
      run: async (args) => ({
        url: args[3],
        titre: "Lucy",
        markdown: "Lucy est une mage.",
      }),
    });
    expect(recovered.imported).toBe(1);
  } finally {
    release();
    await rejected;
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("busy wiki and Fancaps collectors cannot reset an active queue", async () => {
  const a = new Archive(":memory:");
  try {
    initFancaps(a);
    a.db.run("UPDATE fancaps_pages SET state='running'");
    await withCollectorLease(a, "fancaps:7261", async () => {
      await rejects(
        () => collectFancaps(a, { maxPages: 1 }),
        "already running",
      );
      expect(
        a.db.query("SELECT state FROM fancaps_pages LIMIT 1").get(),
      ).toEqual({ state: "running" });
    });
    await withCollectorLease(a, "wiki:fandom-fr", async () => {
      await rejects(
        () =>
          crawlWiki(a, {
            sourceIds: ["fandom-fr"],
            run: async () => {
              throw new Error("must never run");
            },
          }),
        "already running",
      );
      expect(
        a.db
          .query("SELECT name FROM sqlite_master WHERE name='wiki_jobs'")
          .get(),
      ).toBe(null);
    });
  } finally {
    a.close();
  }
});

test("single character retrieval obeys requested result caps", () => {
  const a = new Archive(":memory:");
  try {
    for (let i = 0; i < 60; i++)
      a.ingest(
        `https://example.test/${i}`,
        `Mage ${i}`,
        "N. est un mage de Fairy Tail.",
      );
    expect(a.search("n", 1)).toHaveLength(1);
    expect(a.search("n", 7)).toHaveLength(7);
  } finally {
    a.close();
  }
});
