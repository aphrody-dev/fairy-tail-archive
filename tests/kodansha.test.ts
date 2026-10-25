import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import {
  parseKodanshaChapter,
  kodanshaPageUrl,
  storeKodanshaManifest,
  readableKodanshaScreenshot,
  KODANSHA_CHAPTER,
  type KodanshaManifest,
} from "../packages/manga/kodansha.ts";

function fixtureHtml(point = 0, visible = 1) {
  const data = [
    45,
    458,
    "【第1話】妖精の尻尾（フェアリーテイル）",
    point,
    visible,
    "FAIRY TAIL",
    "真島ヒロ",
    {
      title_id: 0,
      episode_id: 1,
      episode_name: 2,
      point: 3,
      is_page_visible: 4,
    },
    { title_id: 0, title_name: 5, author_text: 6 },
  ];
  return `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(data)}</script>`;
}
function page(letter: string) {
  return `https://mgpk-cdn.magazinepocket.com/static/web_titles/45/episodes/458/${letter.repeat(64)}.jpg?Expires=1799999999&Signature=fixture&Key-Pair-Id=K335WU8AARLF64`;
}
function manifest(): KodanshaManifest {
  return {
    chapter: parseKodanshaChapter(fixtureHtml()),
    pages: [page("a"), page("b"), page("c")],
    scrambled: true,
    descriptorCount: 0,
    direction: 1,
    source: "Bun.WebView/public reader props",
    chapterComplete: false,
  };
}
function failure(task: () => unknown) {
  try {
    task();
    return "";
  } catch (e) {
    return String(e);
  }
}

test("Official chapter metadata is parsed from inert Nuxt JSON without inventing an ISBN", () => {
  const chapter = parseKodanshaChapter(fixtureHtml());
  expect(chapter.url).toBe(KODANSHA_CHAPTER);
  expect(chapter.title).toContain("第1話");
  expect(chapter.author).toBe("真島ヒロ");
  expect(chapter.point).toBe(0);
  expect(chapter.visible).toBe(true);
  expect(
    failure(() => parseKodanshaChapter("<script>malicious()</script>")),
  ).toContain("absentes");
});

test("Manifest persists preview metadata and never treats obfuscated CDN resources as cached readable pages", () => {
  const archive = new Archive(":memory:");
  try {
    const id = storeKodanshaManifest(archive, manifest());
    const volume = archive.db
      .query<
        {
          language: string;
          scope: string;
          state: string;
          isbn13: string | null;
          provenance_json: string;
        },
        [number]
      >("SELECT * FROM manga_volumes WHERE id=?")
      .get(id)!;
    expect(volume.language).toBe("ja");
    expect(volume.scope).toBe("preview");
    expect(volume.state).toBe("manifest_only");
    expect(volume.isbn13).toBe(null);
    expect(JSON.parse(volume.provenance_json).chapterComplete).toBe(false);
    expect(
      archive.db
        .query<{ n: number }, []>("SELECT count(*) n FROM manga_pages")
        .get()!.n,
    ).toBe(3);
    expect(
      archive.db
        .query<{ n: number }, []>(
          "SELECT count(*) n FROM manga_assets WHERE cache_state='cached'",
        )
        .get()!.n,
    ).toBe(0);
    expect(
      archive.db
        .query<{ cache_state: string }, []>(
          "SELECT cache_state FROM manga_assets LIMIT 1",
        )
        .get()!.cache_state,
    ).toBe("reader_only");
    storeKodanshaManifest(archive, {
      ...manifest(),
      pages: [page("a"), page("b")],
    });
    expect(
      archive.db
        .query<{ n: number }, []>("SELECT count(*) n FROM manga_pages")
        .get()!.n,
    ).toBe(2);
    expect(
      failure(() =>
        storeKodanshaManifest(archive, {
          ...manifest(),
          chapter: parseKodanshaChapter(fixtureHtml(30)),
        }),
      ),
    ).toContain("gratuit");
    expect(
      failure(() =>
        storeKodanshaManifest(archive, {
          ...manifest(),
          chapter: parseKodanshaChapter(fixtureHtml(0, 0)),
        }),
      ),
    ).toContain("gratuit");
    expect(
      failure(() =>
        storeKodanshaManifest(archive, { ...manifest(), descriptorCount: 1 }),
      ),
    ).toContain("descripteurs");
  } finally {
    archive.close();
  }
});

test("CDN scope cannot be expanded to arbitrary origins, other episodes or invented request parameters", () => {
  expect(kodanshaPageUrl(page("a"))).toBe(page("a"));
  expect(
    failure(() =>
      kodanshaPageUrl(
        page("a").replace("mgpk-cdn.magazinepocket.com", "evil.test"),
      ),
    ),
  ).toContain("hors du CDN");
  expect(
    failure(() => kodanshaPageUrl(page("a").replace("/458/", "/999/"))),
  ).toContain("hors du CDN");
  expect(
    failure(() => kodanshaPageUrl(page("a") + "&token=unknown")),
  ).toContain("non observé");
});

test("Only a complete, uncovered and order-mapped browser screenshot is eligible for a readable asset", () => {
  const geometry = {
    ordinal: 2,
    rect: { x: 533.5, y: 17.5, width: 533.5, height: 765 },
    viewport: { width: 1082, height: 1704 },
    canvas: { width: 960, height: 1378 },
    uncovered: true,
    imageLoaded: true,
    itemCount: 84,
  };
  expect(readableKodanshaScreenshot(geometry)).toBe(true);
  expect(readableKodanshaScreenshot({ ...geometry, imageLoaded: false })).toBe(
    false,
  );
  expect(readableKodanshaScreenshot({ ...geometry, uncovered: false })).toBe(
    false,
  );
  expect(
    readableKodanshaScreenshot({
      ...geometry,
      rect: { ...geometry.rect, y: -100 },
    }),
  ).toBe(false);
  expect(readableKodanshaScreenshot({ ...geometry, ordinal: 4 })).toBe(false);
  expect(readableKodanshaScreenshot({ ...geometry, itemCount: 2 })).toBe(false);
});
