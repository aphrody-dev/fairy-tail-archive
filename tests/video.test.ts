import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { contained, indexEpisode } from "../packages/video/index.ts";
import {
  embeddedJson,
  parseNetflixMarkdown,
  parseYoutubeInitial,
  parseYoutubeContinuation,
  saveMediaListing,
  mediaCatalog,
  linkLocalEpisode,
  type MediaListing,
} from "../packages/video/sources.ts";

test("public Netflix catalogue preserves item ordinals without inventing playback IDs", () => {
  const listing = parseNetflixMarkdown(
    "# Fairy Tail\n\n## Fairy Tail\n\n- 2018\n- 6 Seasons\n\nSynopsis.\n\n## Episodes\n\n- ![](https://example.test/1.jpg)22m\n\n  1\\. The Fairy Tail\n\n  Lucy rejoint Natsu.\n- ![](https://example.test/2.jpg)23m\n\n  2\\. Fire Dragon\n\n  Une mission.\n\n## More Details\n\n#### Audio\n\nFrench, Japanese [Original]\n\n#### Subtitles\n\nFrench\n",
  );
  expect(listing.advertisedSeasons).toBe(6);
  expect(listing.items).toHaveLength(2);
  expect(listing.items[0]?.durationSeconds).toBe(1320);
  expect(listing.items[1]?.summary).toBe("Une mission.");
  expect(listing.items[0]?.providerId).toBe(null);
  expect(listing.items[0]?.season).toBe(null);
});

test("YouTube reads only selected videos tab and preserves continuation", () => {
  const video = {
    lockupViewModel: {
      contentId: "E_PLC3JyC6s",
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: {
        lockupMetadataViewModel: {
          title: { content: "FAIRY TAIL VOSTFR - EP10 - Natsu contre Erza" },
        },
      },
      contentImage: {
        overlays: [{ thumbnailBadgeViewModel: { text: "22:58" } }],
      },
    },
  };
  const data = {
    metadata: {
      channelMetadataRenderer: {
        externalId: "UCw_-JNNXDmCqxGgXbWD9M5w",
        title: "FAIRY TAIL ANIME FR - OFFICIEL",
        description: "Chaîne publique.",
      },
    },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                richGridRenderer: {
                  contents: [
                    video,
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: { token: "next-public-page" },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    header: {
      unrelated: {
        continuationItemRenderer: {
          continuationEndpoint: {
            continuationCommand: { token: "about-not-video" },
          },
        },
      },
    },
  };
  const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script><script>ytcfg.set(${JSON.stringify({ INNERTUBE_CONTEXT: { client: { clientVersion: "test-version" } } })});</script>`;
  const listing = parseYoutubeInitial(html);
  expect(listing.items).toHaveLength(1);
  expect(listing.items[0]?.episode).toBe(10);
  expect(listing.items[0]?.durationSeconds).toBe(1378);
  expect(listing.items[0]?.audioLanguages).toEqual(["ja"]);
  expect(listing.continuation).toBe("next-public-page");
  expect(listing.clientVersion).toBe("test-version");
  expect(
    parseYoutubeContinuation({
      onResponseReceivedActions: [
        { appendContinuationItemsAction: { continuationItems: [video] } },
      ],
    }).items,
  ).toHaveLength(1);
  expect(
    embeddedJson(
      "start " +
        JSON.stringify({ quoted: '} escaped " text', value: { a: 1 } }) +
        " trailing",
      "start",
    ),
  ).toEqual({ quoted: '} escaped " text', value: { a: 1 } });
});

test("media catalogue is idempotent and keeps local frame links across refresh", () => {
  const archive = new Archive(":memory:");
  try {
    const listing: MediaListing = {
      provider: "youtube",
      sourceId: "UCw_-JNNXDmCqxGgXbWD9M5w",
      url: "https://www.youtube.com/@fairytailanimefr-officiel5083/videos",
      title: "Fairy Tail",
      description: "Public catalogue",
      language: "fr",
      advertisedSeasons: null,
      continuation: null,
      items: [
        {
          itemKey: "E_PLC3JyC6s",
          providerId: "E_PLC3JyC6s",
          title: "FAIRY TAIL EP10",
          url: "https://www.youtube.com/watch?v=E_PLC3JyC6s",
          episode: 10,
          season: null,
          durationSeconds: 1378,
          summary: "Natsu contre Erza.",
          audioLanguages: ["ja"],
          subtitleLanguages: ["fr"],
        },
      ],
    };
    saveMediaListing(archive, listing, { transport: "test" });
    archive.db
      .query(
        "INSERT INTO episodes(id,path,fingerprint,metadata) VALUES(?,?,?,?)",
      )
      .run("local-episode", "data/media/example.mp4", "test-hash", "{}");
    linkLocalEpisode(archive, "youtube", "E_PLC3JyC6s", "local-episode");
    saveMediaListing(archive, listing, { transport: "refresh" });
    expect(mediaCatalog(archive).items).toHaveLength(1);
    expect(mediaCatalog(archive).items[0]?.episode_id).toBe("local-episode");
    expect(archive.stats().documents).toBe(1);
  } finally {
    archive.close();
  }
});

const fixture = Bun.env.VIDEO_FIXTURE;
(fixture ? test : test.skip)(
  "native video indexes every frame and resumes an interrupted episode",
  async () => {
    const root = mkdtempSync(resolve("data/video-test-"));
    const archive = new Archive(":memory:");
    try {
      const media = resolve(root, "media"),
        output = resolve(root, "frames");
      mkdirSync(media, { recursive: true });
      const source = resolve(media, "fixture.mp4");
      await Bun.write(source, await Bun.file(fixture!).bytes());
      const result = await indexEpisode(archive, source, {
        mediaRoot: media,
        outputRoot: output,
        batchSize: 2,
      });
      expect(result.frames).toBe(result.metadata.frameCount);
      expect(archive.stats().frames).toBeGreaterThan(0);
      const before = archive.db
        .query<{ hash: string }, []>("SELECT hash FROM frames ORDER BY number")
        .all();
      archive.db.query("DELETE FROM frames WHERE number>=2").run();
      archive.db
        .query("UPDATE episodes SET next_frame=2,status='interrupted'")
        .run();
      await indexEpisode(archive, source, {
        mediaRoot: media,
        outputRoot: output,
        batchSize: 2,
      });
      expect(
        archive.db.query("SELECT hash FROM frames ORDER BY number").all(),
      ).toEqual(before);
      expect(
        archive.db
          .query<{ status: string }, []>("SELECT status FROM episodes")
          .get()!.status,
      ).toBe("complete");
      let rejected = false;
      try {
        contained(media, resolve(root));
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      archive.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);
