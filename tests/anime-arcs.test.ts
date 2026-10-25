import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import {
  arcSources,
  parseAnimeArcs,
  collectAnimeArcs,
  listAnimeArcs,
} from "../packages/anime-catalog/arcs.ts";
function throws(fn: () => unknown) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
const english = {
  url: arcSources[1].url,
  revid: 42,
  wikitext: `==[[Test arc]]*==
{{Arc
|Total Episodes=3
|Chapters=*[[Chapter 1]]
|Episodes=
*[[Episode 2|Two]]
*[[Episode 4|Four]]
}}
==[[No anime arc]]==
{{Arc
|Total Chapters=17
|Total Episodes=11
|Chapters=*[[Chapter 80]]
}}
==[[Sequel arc]]==
{{Arc
|Total Episodes=2
|Episodes=
*[[FT100YQ Episode 1|First]]
*[[FT100YQ Episode 2|Second]]
}}`,
};
test("Arc parsing preserves explicit numbering, counts, gaps, unofficial names and unavailable ranges", () => {
  const rows = parseAnimeArcs(english, "en");
  expect(rows.length).toBe(3);
  expect(rows[0]?.episodeNumbers).toEqual([2, 4]);
  expect(rows[0]?.firstEpisode).toBe(2);
  expect(rows[0]?.lastEpisode).toBe(4);
  expect(rows[0]?.qualification).toBe(
    "declared_count_mismatch;explicit_noncontiguous_episode_links",
  );
  expect(rows[0]?.naming).toBe("community_unofficial");
  expect(rows[0]?.revision).toBe(42);
  expect(rows[0]?.rawRange.includes("Episode 4")).toBe(true);
  expect(rows[1]?.firstEpisode).toBe(null);
  expect(rows[1]?.episodeNumbers).toEqual([]);
  expect(
    rows[1]?.qualification.includes("no_explicit_anime_episode_links"),
  ).toBe(true);
  expect(rows[2]?.episodeNamespace).toBe("FT100YQ");
  expect(rows[2]?.workId).toBe(null);
});
test("Mixed namespaces cannot imply a single episode range; manga-volume evidence stays distinct", () => {
  const mixed = parseAnimeArcs(
    {
      ...english,
      wikitext:
        "==[[Mixed arc]]==\n{{Arc\n|Episodes=\n*[[Episode 1]]\n*[[FT100YQ Episode 2]]\n}}",
    },
    "en",
  )[0]!;
  expect(mixed.firstEpisode).toBe(null);
  expect(mixed.lastEpisode).toBe(null);
  expect(mixed.qualification.includes("mixed_episode_numbering")).toBe(true);
  const ja = parseAnimeArcs(
    {
      url: arcSources[2].url,
      markdown:
        "## あらすじ\n\nガルナ島編（4巻 - 6巻）\n\n物語。\n\n## 登場人物\n\n別の編（8巻 - 9巻）",
    },
    "ja",
  );
  expect(ja.length).toBe(1);
  expect(ja[0]?.rawRange).toBe("4巻 - 6巻");
  expect(ja[0]?.rangeKind).toBe("manga_volumes");
  expect(ja[0]?.firstEpisode).toBe(null);
  expect(
    throws(() =>
      parseAnimeArcs(
        { ...english, url: "https://untrusted.test/wiki/Story_Arcs" },
        "en",
      ),
    ),
  ).toBe(true);
});
test("Arc collector checkpoints sources, keeps failed refreshes and reads without table creation", async () => {
  const a = new Archive(":memory:");
  try {
    expect(listAnimeArcs(a)).toEqual([]);
    expect(
      a.db
        .query("SELECT name FROM sqlite_master WHERE name='anime_arcs'")
        .get(),
    ).toBe(null);
    a.ingest(
      arcSources[2].url,
      "FAIRY TAIL",
      "## あらすじ\n\n架空編（2巻 - 3巻）\n\n## 次",
      "ja",
    );
    const run = async (args: string[]) =>
      args[1] === arcSources[0].url
        ? { ...english, url: arcSources[0].url }
        : english;
    const report = await collectAnimeArcs(a, { run });
    expect(report.errors).toEqual([]);
    expect(report.arcs).toBe(7);
    expect(report.complete).toBe(false);
    const rows = listAnimeArcs(a, { lang: "en", limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0]?.title).toBe("Test arc");
    expect(rows[0]?.episodeNumbers).toEqual([2, 4]);
    const failed = await collectAnimeArcs(a, {
      maxPages: 1,
      run: async () => {
        throw new Error("source offline");
      },
    });
    expect(failed.errors.length).toBe(1);
    expect(listAnimeArcs(a, { lang: "fr" }).length).toBe(3);
    expect(throws(() => listAnimeArcs(a, { limit: 101 }))).toBe(true);
    expect(throws(() => listAnimeArcs(a, { lang: "und" }))).toBe(true);
    expect(a.stats().documents).toBe(1);
  } finally {
    a.close();
  }
});
