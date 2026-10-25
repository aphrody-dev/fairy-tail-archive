import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { indexEpisode } from "../packages/video/index.ts";
import {
  streamCatalog,
  findStream,
  storeStream,
  inspectHlsManifest,
  inspectDashManifest,
  probeHls,
  parseOfficialVideoLinks,
  getHlsPlayerAssets,
  hlsPlayerAssetResponse,
  type StreamInput,
} from "../packages/streams/index.ts";

const video = "E_PLC3JyC6s",
  watch = `https://www.youtube.com/watch?v=${video}`;
const hls =
  "https://manifest.googlevideo.com/api/manifest/hls_playlist/test-fixture";
const candidate: StreamInput = {
  provider: "youtube",
  providerId: video,
  kind: "hls",
  title: "Protocol fixture",
  url: hls,
  sourceUrl: watch,
  language: "ja",
  access: "public",
  status: "observed-manifest-url",
  evidence: { scope: "unit-test protocol fixture" },
};
test("cached promotional stream survives remote expiry only while its real contained file exists", async () => {
  const a = new Archive(":memory:");
  mkdirSync("data/media", { recursive: true });
  const root = mkdtempSync(resolve("data/media/stream-dto-test-"));
  try {
    const body = await Bun.file(
        resolve(import.meta.dir, "fixtures/native-silent.mp4"),
      ).bytes(),
      sha = new Bun.CryptoHasher("sha256").update(body).digest("hex"),
      path = resolve(root, `stream-${sha}.mp4`);
    await Bun.write(path, body);
    const indexed = await indexEpisode(a, path, {
      mediaRoot: root,
      outputRoot: resolve(root, "frames"),
    });
    const id = storeStream(a, {
      provider: "netflix",
      providerId: "70266998",
      kind: "mp4",
      title: "Promotion",
      url: "https://test.nflxso.net/promo.mp4",
      sourceUrl: "https://www.netflix.com/title/70266998",
      language: "und",
      access: "public",
      status: "media-header-verified",
      expiresAt: "2000-01-01T00:00:00Z",
      evidence: { scope: "public-page-promotional-preview" },
    });
    a.db.run(
      "CREATE TABLE stream_local_assets(stream_id INTEGER PRIMARY KEY,episode_id TEXT,path TEXT,sha256 TEXT,bytes INTEGER,kind TEXT)",
    );
    a.db
      .query("INSERT INTO stream_local_assets VALUES(?,?,?,?,?,?)")
      .run(id, indexed.id, path, sha, body.length, "promotional-preview");
    const cached = findStream(a, id)!;
    expect(cached.expired).toBe(true);
    expect(cached.cachedFileUrl).toBe(`/streams/${id}/file`);
    expect(cached.indexedFrames).toBe(15);
    expect(cached.scope).toBe("promotional-preview");
    expect(cached.playbackVerified).toBe(false);
    expect(streamCatalog(a).items[0]?.cachedFileUrl).toBe(cached.cachedFileUrl);
    a.db
      .query("UPDATE stream_local_assets SET path=?")
      .run(resolve(import.meta.dir, "fixtures/native-silent.mp4"));
    expect(findStream(a, id)?.cachedFileUrl).toBe(null);
    a.db.query("UPDATE stream_local_assets SET path=?").run(path);
    await Bun.write(path, "truncated");
    expect(findStream(a, id)?.cachedFileUrl).toBe(null);
    unlinkSync(path);
    const missing = findStream(a, id)!;
    expect(missing.cachedFileUrl).toBe(null);
    expect(missing.indexedFrames).toBe(0);
    expect(missing.scope).toBe(null);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("empty stream reads do not initialize or mutate the database", () => {
  const a = new Archive(":memory:");
  try {
    const before = a.db
      .query("SELECT name FROM sqlite_master ORDER BY name")
      .all();
    expect(streamCatalog(a).counts.total).toBe(0);
    expect(findStream(a, 1)).toBe(null);
    expect(
      a.db.query("SELECT name FROM sqlite_master ORDER BY name").all(),
    ).toEqual(before);
  } finally {
    a.close();
  }
});

test("signed URL rotations retain stream identity without claiming playback", () => {
  const a = new Archive(":memory:");
  try {
    const first = storeStream(a, {
      ...candidate,
      expiresAt: "2000-01-01T00:00:00.000Z",
      ephemeral: true,
    });
    const second = storeStream(a, {
      ...candidate,
      url: `${hls}?expire=946684800&sig=new`,
      expiresAt: "2000-01-01T00:00:00.000Z",
      ephemeral: true,
    });
    expect(first).toBe(second);
    expect(streamCatalog(a).counts.hls).toBe(1);
    expect(findStream(a, first)?.expired).toBe(true);
    expect(findStream(a, first)?.playbackVerified).toBe(false);
    expect(
      streamCatalog(a, { provider: "youtube", kind: "hls", limit: 1 }).items,
    ).toHaveLength(1);
    let blocked = false;
    try {
      storeStream(a, {
        ...candidate,
        url: "https://manifest.googlevideo.com/picture.jpg",
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    blocked = false;
    try {
      storeStream(a, { ...candidate, url: "http://127.0.0.1/private.m3u8" });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  } finally {
    a.close();
  }
});

test("HLS checks real playlist signatures and separates image lists and DRM", () => {
  const master = inspectHlsManifest(
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nhigh/index.m3u8\n",
  );
  expect(master.variants).toBe(2);
  expect(master.segments).toBe(0);
  expect(master.drm).toBe(false);
  const media = inspectHlsManifest(
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:5,\nseg.ts\n#EXT-X-ENDLIST',
  );
  expect(media.segments).toBe(1);
  expect(media.drm).toBe(true);
  expect(media.endList).toBe(true);
  for (const body of [
    "JPEG image data",
    "#EXTM3Ugarbage\n#EXTINF:1,\na.ts",
    "#EXTM3U\n#EXT-X-IMAGES-ONLY\n#EXTINF:1,\nimage.jpg",
    "x".repeat(1024 * 1024 + 1),
  ]) {
    let rejected = false;
    try {
      inspectHlsManifest(body);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  }
});

test("DASH records protection declarations without claiming a licence", () => {
  expect(
    inspectDashManifest(
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet/></Period></MPD>',
    ).drm,
  ).toBe(false);
  expect(
    inspectDashManifest(
      '<MPD><Period><ContentProtection schemeIdUri="urn:uuid:test"/></Period></MPD>',
    ).drm,
  ).toBe(true);
  let rejected = false;
  try {
    inspectDashManifest(
      '<!DOCTYPE MPD SYSTEM "https://evil.test/entity"><MPD><Period/></MPD>',
    );
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("HLS probing is restricted to an already observed URL and never requests segments", async () => {
  const a = new Archive(":memory:");
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    expect(String(input)).toBe(hls);
    return new Response("#EXTM3U\n#EXTINF:3,\nsegment.ts\n#EXT-X-ENDLIST", {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    });
  };
  try {
    let blocked = false;
    try {
      await probeHls(a, "https://evil.test/playlist.m3u8", { fetcher });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    expect(calls).toBe(0);
    const id = storeStream(a, candidate),
      result = await probeHls(a, id, { fetcher });
    expect(calls).toBe(1);
    expect(result.stream?.status).toBe("manifest-verified");
    expect(result.stream?.playbackVerified).toBe(false);
    expect(result.stream?.mime).toBe("application/vnd.apple.mpegurl");
    blocked = false;
    try {
      await probeHls(a, id, {
        fetcher: async () =>
          new Response("#EXTM3U\n#EXTINF:3,\nsegment.ts", {
            headers: { "Content-Type": "image/jpeg" },
          }),
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  } finally {
    a.close();
  }
});

test("official video discovery uses observed embeds and player IDs rather than thumbnail images", () => {
  const links = parseOfficialVideoLinks(
    `<li><iframe src="//www.youtube.com/embed/-Tw0CVQh4F4"></iframe><h2>FAIRY TAIL ending</h2></li><a onClick="Contents.showMovie('PVrKCN3D_RY',this)"></a><p class="movie-ttl">Fairy Tail PV</p><img src="https://img.youtube.com/vi/notSource01/0.jpg"><iframe src="https://evilyoutube.com/embed/abcdefghijk"></iframe>`,
    "https://www.fairytail100yq.com/movie/",
  );
  expect(links).toHaveLength(2);
  expect(links[0]?.title).toBe("FAIRY TAIL ending");
  expect(links[0]?.embedObserved).toBe(true);
  expect(links[1]?.title).toBe("Fairy Tail PV");
  expect(links[1]?.embedObserved).toBe(false);
  let rejected = false;
  try {
    parseOfficialVideoLinks("", "https://evil.test/movie/");
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("HLS player assets reuse the installed native owner without exposing arbitrary files", async () => {
  expect((await hlsPlayerAssetResponse("../../private")).status).toBe(404);
  const status = await getHlsPlayerAssets();
  expect(typeof status.available).toBe("boolean");
  if (status.available) {
    expect(status.qualification.browserPlaybackVerified).toBe(false);
    const response = await hlsPlayerAssetResponse("LICENSE");
    expect(response.status).toBe(200);
    expect((await response.text()).includes("Apache License")).toBe(true);
    expect(
      (
        await hlsPlayerAssetResponse(
          "LICENSE",
          new Headers({ "If-None-Match": response.headers.get("etag")! }),
        )
      ).status,
    ).toBe(304);
  }
});
