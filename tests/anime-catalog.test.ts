import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import {
  ANIME_CATALOG_URL,
  animeWorkUrl,
  animeWorkId,
  parseAnimeCatalogue,
  storeAnimeCatalogue,
  listAnimeWorks,
  getAnimeWork,
  animeCatalogStatus,
} from "../packages/anime-catalog/index.ts";

test("inert catalogue parser deduplicates links and reports numbered gaps without inventing seasons", async () => {
  const root = ANIME_CATALOG_URL;
  const html = `<h1>Fairy Tail (VF)</h1><div class=summary-heading><h5>Type</h5></div><div class=summary-content>TV</div><div class=summary-heading><h5>Episodes</h5></div><div class=summary-content>4</div><script>throw new Error('must not execute');<a href="${root}fake/">Fairy Tail - 003 VF</a></script><a href="${root}one/">Fairy <b>Tail</b> - 001 VF - 001</a><a href="${root}one/">Fairy Tail - 001 VF - 001</a><a href="${root}three/">Fairy Tail - 003 VF - 003</a><a href="${root}three-alt/">Fairy Tail - 003 VF - 003</a><a href="https://elsewhere.test/anime/fairy-tail-vf/four/">Fairy Tail - 004</a><a href="/anime/fairy-tail-ova/">Fairy Tail OVA</a><a href="/anime/fairy-gone/">Fairy Gone</a><iframe src="https://player.test/full.m3u8"></iframe>`;
  const listing = await parseAnimeCatalogue(html, root);
  expect(listing.title).toBe("Fairy Tail (VF)");
  expect(listing.kind).toBe("series");
  expect(listing.language).toBe("fr");
  expect(listing.episodes.map((e) => e.number)).toEqual([1, 3, 3]);
  expect(listing.episodes.every((e) => e.season === null)).toBe(true);
  expect(listing.audit.rawEpisodeLinks).toBe(4);
  expect(listing.audit.duplicateUrls).toEqual([`${root}one/`]);
  expect(listing.audit.duplicateNumbers).toEqual([3]);
  expect(listing.audit.missingNumbers).toEqual([2, 4]);
  expect(listing.audit.numberingComplete).toBe(false);
  expect(listing.audit.countMismatch).toBe(true);
  expect(listing.audit.mediaAcquired).toBe(false);
  expect(listing.related).toEqual([
    {
      url: "https://voir-anime.to/anime/fairy-tail-ova/",
      title: "Fairy Tail OVA",
    },
  ]);
});

test("snapshot replacement removes stale episodes and keeps exact source provenance", async () => {
  const a = new Archive(":memory:");
  try {
    expect(listAnimeWorks(a)).toEqual([]);
    expect(animeCatalogStatus(a).counts.anime_works).toBe(0);
    expect(
      a.db
        .query("SELECT name FROM sqlite_master WHERE name='anime_works'")
        .get(),
    ).toBe(null);
    const first = await parseAnimeCatalogue(
      `# Fairy Tail (VF)\n##### Type\n\nTV\n##### Episodes\n\n2\n[Fairy Tail - 001 VF - 001](${ANIME_CATALOG_URL}one/)\n[Fairy Tail - 002 VF - 002](${ANIME_CATALOG_URL}two/)`,
      ANIME_CATALOG_URL,
    );
    const source = {
      hash: "a".repeat(64),
      fetchedAt: "2026-10-25T00:00:00.000Z",
      rawPath: "fixture-only.html",
    };
    const id = storeAnimeCatalogue(a, first, source);
    expect(id).toBe(animeWorkId(ANIME_CATALOG_URL));
    expect(getAnimeWork(a, id, { limit: 1 })?.episodes.length).toBe(1);
    storeAnimeCatalogue(
      a,
      { ...first, episodes: first.episodes.slice(0, 1) },
      { ...source, hash: "b".repeat(64) },
    );
    expect(animeCatalogStatus(a).counts.anime_episodes).toBe(1);
    expect(listAnimeWorks(a)).toHaveLength(1);
    expect(
      a.db
        .query("SELECT source_tier,source_hash,season FROM anime_works")
        .get(),
    ).toEqual({
      source_tier: "unofficial",
      source_hash: "b".repeat(64),
      season: null,
    });
    expect(a.search("Fairy Tail")[0]?.url).toBe(ANIME_CATALOG_URL);
  } finally {
    a.close();
  }
});

test("catalogue URL allowlist rejects credentials, query endpoints, external hosts and unrelated works", () => {
  expect(
    animeWorkUrl("https://voir-anime.to/anime/fairy-tail-100-years-quest/"),
  ).toBe("https://voir-anime.to/anime/fairy-tail-100-years-quest/");
  for (const url of [
    "https://evil.test/anime/fairy-tail/",
    "https://voir-anime.to/anime/fairy-gone/",
    "https://user@voir-anime.to/anime/fairy-tail/",
    "https://voir-anime.to/anime/fairy-tail/?player=1",
    "https://voir-anime.to/anime/fairy-tail/episode-1/",
  ])
    expect(animeWorkUrl(url)).toBe(null);
});
