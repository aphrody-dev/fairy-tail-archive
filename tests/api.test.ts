import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import { createServer, stopServer } from "../apps/api/main.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

test("Anime metadata and native capability endpoints stay read-only with bounded input", async () => {
  const a = new Archive(":memory:"),
    server = createServer(a, 0);
  const before = a.db
    .query<{ n: number }, []>("SELECT count(*) n FROM sqlite_master")
    .get()!.n;
  try {
    for (const path of ["/anime/works", "/anime/arcs?lang=ja"]) {
      const response = await fetch(new URL(path, server.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    expect(
      (await fetch(new URL("/anime/arcs?lang=invalid", server.url))).status,
    ).toBe(400);
    expect(
      (await fetch(new URL("/anime/works?limit=1000000", server.url))).status,
    ).toBe(400);
    const capability = await (
      await fetch(new URL("/media/capabilities", server.url))
    ).json();
    expect(capability.engine).toBe("Bun.Video / FilmCraft");
    expect(capability.operations.hls.executionEnabled).toBe(false);
    expect(
      a.db
        .query<{ n: number }, []>("SELECT count(*) n FROM sqlite_master")
        .get()!.n,
    ).toBe(before);
  } finally {
    await server.stop(true);
    a.close();
  }
});

test("HTTP hardening preserves native byte ranges, HEAD and graceful closure", async () => {
  const dir = mkdtempSync(resolve("data/ft-http-"));
  const archive = new Archive(":memory:");
  const id = "a".repeat(24),
    path = resolve(dir, "video.mp4");
  await Bun.write(
    path,
    new Uint8Array(100).map((_, i) => i),
  );
  archive.db
    .query("INSERT INTO episodes(id,path,fingerprint,metadata) VALUES(?,?,?,?)")
    .run(id, path, "test", "{}");
  const server = createServer(archive, 0);
  try {
    const response = await fetch(new URL(`/episodes/${id}/video`, server.url), {
      headers: { Range: "bytes=10-19" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "object-src 'none'",
    );
    expect(response.headers.get("X-Request-ID")?.length).toBe(36);
    const head = await fetch(new URL("/health", server.url), {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (let i = 0; i < 12; i++)
      await (
        await fetch(new URL("/index/search?q=test", server.url))
      ).arrayBuffer();
    const limited = await fetch(new URL("/index/search?q=test", server.url));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("2");
    await limited.arrayBuffer();
  } finally {
    await stopServer(server, archive, 1000);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP contracts expose OpenAPI, GraphQL POST, catalogues and cache-only CDN", async () => {
  const archive = new Archive(":memory:");
  archive.ingest("local:test", "Natsu", "Natsu est un mage de feu.", "fr");
  const server = createServer(archive, 0);
  try {
    const spec = await (
      await fetch(new URL("/openapi.json", server.url))
    ).json();
    expect(spec.openapi).toBe("3.1.1");
    expect(spec.servers[0].url).toBe(server.url.origin);
    expect(typeof spec.paths["/graphql"].post).toBe("object");
    const response = await fetch(new URL("/graphql", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          'query Find($q: String!) { stats { documents } search(q:$q,lang:"fr") { title } }',
        variables: { q: "Natsu" },
      }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data.stats.documents).toBe(1);
    expect(result.data.search[0].title).toBe("Natsu");
    expect(
      (await fetch(new URL("/cdn/fancaps/4911821", server.url))).status,
    ).toBe(404);
    expect(
      (await fetch(new URL("/fancaps?limit=201", server.url))).status,
    ).toBe(400);
    expect((await fetch(new URL("/catalog/books", server.url))).status).toBe(
      200,
    );
    expect((await fetch(new URL("/catalog/videos", server.url))).status).toBe(
      200,
    );
    expect(
      (await fetch(new URL("/index/search?q=Natsu", server.url))).status,
    ).toBe(503);
  } finally {
    server.stop(true);
    archive.close();
  }
});
