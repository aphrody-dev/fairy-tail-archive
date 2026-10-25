import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import {
  importWikiPage,
  seedWiki,
  crawlWiki,
  wikiLinks,
  type WikiPage,
} from "../packages/crawler/wiki.ts";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
test("Aphrody wiki dossiers preserve source revision and replace documents", () => {
  const a = new Archive(":memory:");
  try {
    const page = {
      url: "https://fairy-tail.fandom.com/fr/wiki/Natsu_Dragnir",
      titre: "Natsu Dragnir",
      markdown: "Natsu utilise le feu.",
      revid: 123,
    };
    importWikiPage(a, page, "fr");
    importWikiPage(
      a,
      { ...page, revid: 124, markdown: "Natsu est un mage." },
      "fr",
    );
    expect(a.stats().documents).toBe(1);
    expect(
      a.db
        .query<{ revid: number }, []>("SELECT revid FROM wiki_provenance")
        .get()!.revid,
    ).toBe(124);
    expect(a.search("Natsu", 10, "fr")[0]?.url).toBe(page.url);
    importWikiPage(
      a,
      { ...page, revid: undefined, markdown: "Natsu est un mage." },
      "fr",
    );
    expect(
      a.db
        .query<{ revid: number | null }, []>(
          "SELECT revid FROM wiki_provenance",
        )
        .get()!.revid,
    ).toBe(124);
    importWikiPage(
      a,
      {
        ...page,
        revid: undefined,
        markdown: "Natsu est un chasseur de dragons.",
      },
      "fr",
    );
    expect(
      a.db
        .query<{ revid: number | null }, []>(
          "SELECT revid FROM wiki_provenance",
        )
        .get()!.revid,
    ).toBe(null);
    let rejected = false;
    try {
      importWikiPage(a, { ...page, url: "http://127.0.0.1/private" }, "fr");
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    a.close();
  }
});

test("Wiki link discovery accepts articles, rejects namespaces and constrains Japanese scope", () => {
  const text =
    "[chapter](https://fairytail.fandom.com/wiki/Fairy_Tail_(Guild)) [[Lucy Heartfilia|Lucy]] [edit](/wiki/Natsu?action=edit) [[Category:Characters]] [file](/wiki/File:Natsu.png) [[Template:Info]] [[Discussion:Natsu]] [outside](https://evil.test/wiki/Natsu) [other language](https://fairy-tail.fandom.com/fr/wiki/Natsu) [anchor](/wiki/Natsu#Appearance) [escaped namespace](/wiki/:Category:Characters)";
  expect(
    wikiLinks("fandom-en", text, "https://fairytail.fandom.com/wiki/Natsu"),
  ).toEqual([
    "https://fairytail.fandom.com/wiki/Fairy_Tail_%28Guild%29",
    "https://fairytail.fandom.com/wiki/Natsu",
    "https://fairytail.fandom.com/wiki/Lucy_Heartfilia",
  ]);
  expect(
    wikiLinks(
      "wikipedia-ja",
      "[[FAIRY TAILの登場人物]] [[NARUTO]] [[カテゴリ:漫画]]",
      "https://ja.wikipedia.org/wiki/FAIRY_TAIL",
    ),
  ).toEqual([
    "https://ja.wikipedia.org/wiki/FAIRY_TAIL%E3%81%AE%E7%99%BB%E5%A0%B4%E4%BA%BA%E7%89%A9",
  ]);
});

test("Wiki crawl expands the existing corpus breadth first and resumes without refetching", async () => {
  const a = new Archive(":memory:"),
    root = mkdtempSync(resolve("data/wiki-crawl-test-"));
  const origin = "https://fairy-tail.fandom.com/fr/wiki/";
  a.ingest(
    `${origin}Natsu`,
    "Natsu",
    `[Lucy](${origin}Lucy) [[Erza]] [[Category:Characters]]`,
    "fr",
  );
  const reads: string[] = [];
  const run = async (args: string[]): Promise<unknown> => {
    const url = args[3]!;
    reads.push(url);
    const title = url.slice(origin.length);
    return {
      url,
      titre: title,
      markdown: `${title} est mage.`,
      wikitext:
        title === "Lucy" ? "[[Happy]]" : title === "Erza" ? "[[Mirajane]]" : "",
    };
  };
  const options = {
    sourceIds: ["fandom-fr"],
    run,
    outputRoot: root,
    delayMs: 0,
  };
  try {
    const first = await crawlWiki(a, { ...options, maxPages: 1 });
    expect(first.imported).toBe(1);
    expect(reads).toEqual([`${origin}Lucy`]);
    const second = await crawlWiki(a, { ...options, maxPages: 2 });
    expect(second.imported).toBe(2);
    expect(reads).toEqual([`${origin}Lucy`, `${origin}Erza`, `${origin}Happy`]);
    await crawlWiki(a, { ...options, maxPages: 2 });
    expect(reads).toEqual([
      `${origin}Lucy`,
      `${origin}Erza`,
      `${origin}Happy`,
      `${origin}Mirajane`,
    ]);
    const last = await crawlWiki(a, { ...options, maxPages: 2 });
    expect(last.attempted).toBe(0);
    expect(last.pending).toBe(0);
    expect(a.stats().documents).toBe(5);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Wiki crawl starts from cached wikitext and retries a failed page only on the next run", async () => {
  const a = new Archive(":memory:"),
    root = mkdtempSync(resolve("data/wiki-cache-test-"));
  const origin = "https://fairytail.fandom.com/wiki/";
  mkdirSync(resolve(root, "fandom-en"), { recursive: true });
  await Bun.write(
    resolve(root, "fandom-en", "seed.json"),
    JSON.stringify({
      url: `${origin}Natsu`,
      titre: "Natsu",
      markdown: "Natsu is a mage.",
      wikitext: "[[Lucy]] [[Happy]]",
    }),
  );
  let failed = false;
  const reads: string[] = [];
  const run = async (args: string[]): Promise<unknown> => {
    const url = args[3]!;
    reads.push(url);
    if (url.endsWith("/Lucy") && !failed) {
      failed = true;
      throw new Error("temporary fixture failure");
    }
    return {
      url,
      titre: url.slice(origin.length),
      markdown: "A Fairy Tail member.",
    };
  };
  const options = {
    sourceIds: ["fandom-en"],
    run,
    outputRoot: root,
    delayMs: 0,
  };
  try {
    const first = await crawlWiki(a, { ...options, maxPages: 3 });
    expect(first.attempted).toBe(2);
    expect(first.pending).toBe(1);
    expect(reads).toEqual([`${origin}Lucy`, `${origin}Happy`]);
    const second = await crawlWiki(a, { ...options, maxPages: 3 });
    expect(second.attempted).toBe(1);
    expect(second.pending).toBe(0);
    expect(a.stats().documents).toBe(3);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Wiki campaign checkpoints each page, retries failures and keeps later results", async () => {
  const a = new Archive(":memory:");
  const root = mkdtempSync(resolve("data/wiki-test-"));
  const pages: WikiPage[] = ["Natsu", "Lucy", "Erza"].map((title) => ({
    url: `https://fairy-tail.fandom.com/fr/wiki/${title}`,
    titre: title,
    markdown: `${title} appartient à Fairy Tail.`,
    revid: 10,
  }));
  let fail = true,
    searches = 0,
    reads = 0;
  const run = async (args: string[]): Promise<unknown> => {
    if (args[0] === "wiki-search") {
      searches++;
      return pages.map((p) => ({ url: p.url, titre: p.titre }));
    }
    reads++;
    const page = pages.find((p) => args.includes(p.url))!;
    if (page.titre === "Lucy" && fail) {
      fail = false;
      throw new Error("Fixture temporary network error");
    }
    return page;
  };
  const options = {
    run,
    sourceIds: ["fandom-fr"],
    queries: { "fandom-fr": ["mages"] },
    outputRoot: root,
    delayMs: 0,
  };
  try {
    const first = await seedWiki(a, options);
    expect(first.report[0]?.imported).toBe(2);
    expect(first.report[0]?.pending).toBe(1);
    expect(a.search("Erza")[0]?.title).toBe("Erza");
    const second = await seedWiki(a, options);
    expect(second.report[0]?.imported).toBe(1);
    expect(second.report[0]?.pending).toBe(0);
    expect(searches).toBe(1);
    expect(reads).toBe(4);
    await seedWiki(a, options);
    expect(reads).toBe(4);
    expect(a.stats().documents).toBe(3);
    const saved = a.db
      .query<{ raw_path: string }, []>(
        "SELECT raw_path FROM wiki_jobs WHERE state='done' LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(await Bun.file(saved.raw_path).text()).revid).toBe(10);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
});
