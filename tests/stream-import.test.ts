import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { storeStream } from "../packages/streams/index.ts";
import {
  importStream,
  streamFileResponse,
} from "../packages/streams/import.ts";

const fixture = resolve(import.meta.dir, "fixtures/native-silent.mp4");
function setup() {
  const a = new Archive(":memory:"),
    root = mkdtempSync(resolve("data/stream-test-"));
  const id = storeStream(a, {
    provider: "netflix",
    providerId: "70266998",
    kind: "mp4",
    title: "Public promotional preview",
    url: "https://ipv4-c001-test.1.oca.nflxso.net/promo.mp4",
    sourceUrl: "https://www.netflix.com/title/70266998",
    language: "und",
    access: "public",
    status: "media-header-verified",
    mime: "video/mp4",
    evidence: { scope: "public-page-promotional-preview; not a full episode" },
  });
  const options = {
    mediaRoot: resolve(root, "media"),
    outputRoot: resolve(root, "frames"),
    maxDuration: 2,
    maxFrames: 20,
    maxOutputBytes: 10 * 1024 ** 2,
  };
  return {
    a,
    id,
    root,
    options,
    close() {
      a.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function rejectText(error: unknown, text: string) {
  expect(String(error)).toContain(text);
}
test("native MP4 import indexes all rational-rate frames and resumes from cached bytes", async () => {
  const s = setup(),
    original = globalThis.fetch;
  let downloads = 0;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    downloads++;
    expect(init?.redirect).toBe("error");
    return new Response(await Bun.file(fixture).bytes(), {
      headers: { "Content-Type": "video/mp4" },
    });
  }) as typeof fetch;
  try {
    const result = await importStream(s.a, s.id, s.options);
    expect(result.frames).toBe(15);
    expect(result.metadata.fpsNumerator).toBe(15);
    expect(result.kind).toBe("promotional-preview");
    expect(result.encodedBytes).toBeGreaterThan(0);
    expect(
      s.a.db
        .query("SELECT name FROM sqlite_master WHERE name='media_local_links'")
        .all(),
    ).toEqual([]);
    expect((await importStream(s.a, s.id, s.options)).frames).toBe(15);
    expect(downloads).toBe(1);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        return streamFileResponse(s.a, s.id, req.headers, s.options.mediaRoot);
      },
    });
    try {
      const range = await original(server.url, {
        headers: { Range: "bytes=0-31" },
      });
      expect(range.status).toBe(206);
      expect((await range.arrayBuffer()).byteLength).toBe(32);
    } finally {
      server.stop(true);
    }
    const served = await streamFileResponse(
      s.a,
      s.id,
      new Headers(),
      s.options.mediaRoot,
    );
    expect(served.status).toBe(200);
    expect((await served.arrayBuffer()).byteLength).toBe(
      Bun.file(fixture).size,
    );
    expect(
      (
        await streamFileResponse(
          s.a,
          s.id,
          new Headers({ "If-None-Match": served.headers.get("etag")! }),
          s.options.mediaRoot,
        )
      ).status,
    ).toBe(304);
    expect(
      (await streamFileResponse(s.a, 999, new Headers(), s.options.mediaRoot))
        .status,
    ).toBe(404);
  } finally {
    globalThis.fetch = original;
    s.close();
  }
}, 30000);
test("stream import rejects catalogue, expired URLs and unregistered origins before fetching", async () => {
  const s = setup(),
    original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("unexpected fetch");
  }) as typeof fetch;
  try {
    for (const [sql, error] of [
      ["UPDATE streams SET kind='catalogue'", "MP4 public"],
      [
        "UPDATE streams SET kind='mp4',expires_at='2000-01-01T00:00:00Z'",
        "expiré",
      ],
      [
        "UPDATE streams SET expires_at=NULL,url='https://localhost/promo.mp4'",
        "Origine",
      ],
    ]) {
      s.a.db.run(sql!);
      try {
        await importStream(s.a, s.id, s.options);
        throw new Error("accepted");
      } catch (e) {
        rejectText(e, error!);
      }
    }
    expect(called).toBe(false);
  } finally {
    globalThis.fetch = original;
    s.close();
  }
});
test("bounded download and native output budgets fail without complete episode claims", async () => {
  const s = setup(),
    original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(await Bun.file(fixture).bytes(), {
      headers: { "Content-Type": "video/mp4" },
    })) as typeof fetch;
  try {
    for (const [limits, error] of [
      [{ maxDownloadBytes: 100 }, "Téléchargement hors budget"],
      [{ maxFrames: 2 }, "Métadonnées vidéo hors budget"],
      [{ maxOutputBytes: 1 }, "Images encodées hors budget"],
    ] as const) {
      try {
        await importStream(s.a, s.id, { ...s.options, ...limits });
        throw new Error("accepted");
      } catch (e) {
        rejectText(e, error);
      }
    }
    expect(
      s.a.db.query<{ status: string }, []>("SELECT status FROM episodes").get()!
        .status,
    ).toBe("interrupted");
    expect(s.a.db.query("SELECT * FROM frames").all()).toEqual([]);
    expect((await importStream(s.a, s.id, s.options)).frames).toBe(15);
  } finally {
    globalThis.fetch = original;
    s.close();
  }
}, 30000);
test("full MP4 response requires MIME, ftyp and complete status", async () => {
  const s = setup(),
    original = globalThis.fetch;
  try {
    for (const response of [
      new Response("not mp4", { headers: { "Content-Type": "video/mp4" } }),
      new Response("wrong mime", { headers: { "Content-Type": "text/html" } }),
      new Response("partial", {
        status: 206,
        headers: { "Content-Type": "video/mp4" },
      }),
    ]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      let failed = false;
      try {
        await importStream(s.a, s.id, s.options);
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    }
    expect(s.a.db.query("SELECT * FROM stream_local_assets").all()).toEqual([]);
  } finally {
    globalThis.fetch = original;
    s.close();
  }
});
test("resume refuses altered cached frames and never overwrites conflicting orphan output", async () => {
  const s = setup(),
    original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(await Bun.file(fixture).bytes(), {
      headers: { "Content-Type": "video/mp4" },
    })) as typeof fetch;
  try {
    const imported = await importStream(s.a, s.id, s.options);
    const row = s.a.db
      .query<{ path: string }, []>("SELECT path FROM frames WHERE number=14")
      .get()!;
    await Bun.write(row.path, "preserve this conflicting file");
    try {
      await importStream(s.a, s.id, s.options);
      throw new Error("accepted");
    } catch (e) {
      rejectText(e, "Image de reprise modifiée");
    }
    s.a.db.query("DELETE FROM frames WHERE number=14").run();
    s.a.db
      .query(
        "UPDATE episodes SET next_frame=14,status='interrupted' WHERE id=?",
      )
      .run(imported.episodeId);
    try {
      await importStream(s.a, s.id, s.options);
      throw new Error("accepted");
    } catch (e) {
      rejectText(e, "Refus d'écraser");
    }
    expect(await Bun.file(row.path).text()).toBe(
      "preserve this conflicting file",
    );
  } finally {
    globalThis.fetch = original;
    s.close();
  }
}, 30000);
