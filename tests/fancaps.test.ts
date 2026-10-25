import { test, expect } from "bun:test";
import { mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import {
  canonicalFancapsPage,
  parseFancapsPage,
  storeFancapsPage,
  fancapsStatus,
  fancapsImageResponse,
  cacheFancapsImage,
  FANCAPS_SERIES_URL,
} from "../packages/video/fancaps.ts";

const episodeUrl =
  "https://fancaps.net/anime/episodeimages.php?7262-Fairy_Tail/Episode_1";
const show = `# Viewing Popular Images From Fairy Tail
### [Images From Episode 1](/anime/episodeimages.php?7262-Fairy_Tail/Episode_1)
[See More Images](${episodeUrl})
[Next >](${FANCAPS_SERIES_URL}&page=2)
[+5 >](${FANCAPS_SERIES_URL}&page=6)
[>>>](${FANCAPS_SERIES_URL}&page=17.5)
`;
const episode = `[Fairy Tail](${FANCAPS_SERIES_URL})
# Images From Fairy Tail Episode 1
[![Fairy Tail Image](https://ant.fancaps.net/4911821.jpg)](https://fancaps.net/anime/picture.php?/4911821)
[![Fairy Tail Image](https://ant.fancaps.net/4911821.jpg)](https://fancaps.net/anime/picture.php?/4911821)
[![Fairy Tail Image](https://ant.fancaps.net/4911822.jpg)](https://fancaps.net/anime/picture.php?/4911822)
[![img](https://cdni.fancaps.net/file/fancaps-movieimages/106585.jpg)](https://fancaps.net/movies/)
[![Fairy Tail Image](https://evil.test/4911823.jpg)](https://fancaps.net/anime/picture.php?/4911823)
[2](episodeimages.php?7262-Fairy_Tail/Episode_1&page=2)
[5](episodeimages.php?7262-Fairy_Tail/Episode_1&page=5)
[Next Episode's Images](https://fancaps.net/anime/episodeimages.php?7263)
`;

test("Fancaps stays in series7261, uses adjacent pagination and excludes sidebar CDN assets", () => {
  expect(
    canonicalFancapsPage(
      "https://evil.test/anime/showimages.php?7261-Fairy_Tail",
    ),
  ).toBe(null);
  expect(
    canonicalFancapsPage(
      "https://fancaps.net/anime/showimages.php?9999-Other_Show",
    ),
  ).toBe(null);
  expect(canonicalFancapsPage(`${FANCAPS_SERIES_URL}&page=0`)).toBe(null);
  expect(canonicalFancapsPage(`${FANCAPS_SERIES_URL}&page=17.5`)).toBe(null);
  const first = parseFancapsPage(FANCAPS_SERIES_URL, show);
  expect(first.episodes).toHaveLength(1);
  expect(first.next?.page).toBe(2);
  const caps = parseFancapsPage(episodeUrl, episode);
  expect(caps.images).toHaveLength(2);
  expect(caps.images[0]?.full_url).toBe(null);
  expect(caps.images[0]?.variant).toBe("thumbnail");
  expect(caps.next?.url).toBe(`${episodeUrl}&page=2`);
});

test("Fancaps import is idempotent and only accepts episodes registered by the show", () => {
  const archive = new Archive(":memory:");
  try {
    let rejected = false;
    try {
      storeFancapsPage(archive, episodeUrl, episode);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    storeFancapsPage(archive, FANCAPS_SERIES_URL, show);
    storeFancapsPage(archive, episodeUrl, episode);
    storeFancapsPage(archive, episodeUrl, episode);
    const status = fancapsStatus(archive);
    expect(status.counts.episodes).toBe(1);
    expect(status.counts.images).toBe(2);
    expect(status.counts.pendingPages).toBe(2);
    expect(status.origins).toHaveLength(1);
    expect(status.images[0]?.local_url).toBe(null);
    expect(fancapsImageResponse(archive, 4911821).status).toBe(404);
    expect(fancapsImageResponse(archive, -1).status).toBe(400);
  } finally {
    archive.close();
  }
});

test("local Fancaps CDN returns exact cached bytes and supports conditional requests without downloading", async () => {
  const archive = new Archive(":memory:");
  const cache = resolve("data/fancaps/cache");
  mkdirSync(cache, { recursive: true });
  const path = resolve(cache, `test-${crypto.randomUUID()}.png`);
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/4cAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  try {
    storeFancapsPage(archive, FANCAPS_SERIES_URL, show);
    storeFancapsPage(archive, episodeUrl, episode);
    await Bun.write(path, bytes);
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    archive.db
      .query(
        "UPDATE fancaps_images SET cache_state='cached',sha256=?,mime='image/png',bytes=?,width=1,height=1,cache_path=? WHERE id=4911821",
      )
      .run(hash, bytes.length, path);
    const response = fancapsImageResponse(archive, 4911821);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(
      fancapsImageResponse(
        archive,
        4911821,
        new Headers({ "If-None-Match": `"${hash}"` }),
      ).status,
    ).toBe(304);
    expect((await cacheFancapsImage(archive, 4911821)).local_url).toBe(
      "/cdn/fancaps/4911821",
    );
    unlinkSync(path);
    expect(fancapsImageResponse(archive, 4911821).status).toBe(404);
  } finally {
    archive.close();
    try {
      unlinkSync(path);
    } catch {
      /* test already removed file */
    }
  }
});
