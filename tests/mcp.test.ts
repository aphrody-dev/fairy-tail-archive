import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { handleMcp, mcpTools, serveMcp } from "../apps/mcp/main.ts";

const init = (id = 1, protocolVersion = "2025-06-18") => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "fixture-client", version: "1" },
  },
});
const call = (
  id: number,
  name: string,
  args: Record<string, unknown> = {},
) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test("MCP negotiates supported versions and exposes exactly nine typed read-only tools", async () => {
  const archive = new Archive(":memory:");
  try {
    for (const version of ["2024-11-05", "2025-03-26", "2025-06-18"]) {
      const response = await handleMcp(archive, init(1, version));
      expect(
        (response!.result as { protocolVersion: string }).protocolVersion,
      ).toBe(version);
    }
    const listed = await handleMcp(archive, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const tools = (listed!.result as { tools: typeof mcpTools }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "fairy_tail_search",
      "fairy_tail_ask",
      "fairy_tail_context",
      "fairy_tail_coverage",
      "fairy_tail_books",
      "fairy_tail_media",
      "fairy_tail_fancaps",
      "fairy_tail_native_status",
      "fairy_tail_library",
    ]);
    expect(
      tools.every(
        (tool) =>
          tool.annotations.readOnlyHint &&
          tool.inputSchema.additionalProperties === false,
      ),
    ).toBe(true);
    expect(
      await handleMcp(archive, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    ).toBe(undefined);
    expect(
      await handleMcp(archive, {
        jsonrpc: "2.0",
        method: "unknown/notification",
      }),
    ).toBe(undefined);
    expect(
      (await handleMcp(archive, { jsonrpc: "2.0", id: 3, method: "ping" }))!
        .result,
    ).toEqual({});
  } finally {
    archive.close();
  }
});

test("MCP library delegates manga preview reads and preserves source asset URLs without writes", async () => {
  const archive = new Archive(":memory:");
  try {
    archive.db
      .run(`CREATE TABLE manga_volumes(id INTEGER PRIMARY KEY,book_url TEXT,title TEXT,isbn13 TEXT,preview_ean TEXT,preview_url TEXT,epub_url TEXT,language TEXT,reading_direction TEXT,scope TEXT,state TEXT);
      INSERT INTO manga_volumes VALUES(1,'https://www.pika.fr/livre/fairy-tail-t01/','Fairy Tail T01','9782845999145','9782811614126','https://www.liseuse-hachette.fr/ean/9782811614126','https://example.test/excerpt.epub','fr','rtl','preview','ready');
      CREATE TABLE manga_pages(id INTEGER PRIMARY KEY,volume_id INTEGER,ordinal INTEGER,document_path TEXT,text TEXT);
      INSERT INTO manga_pages VALUES(1,1,1,'OEBPS/page1.xhtml','Page de présentation.');
      CREATE TABLE manga_assets(id INTEGER PRIMARY KEY,page_id INTEGER,ordinal INTEGER,entry_path TEXT,declared_mime TEXT,source_url TEXT,cache_state TEXT,sha256 TEXT,mime TEXT,bytes INTEGER,width INTEGER,height INTEGER,extract_engine TEXT,native_error TEXT);
      INSERT INTO manga_assets VALUES(5,1,1,'OEBPS/images/page1.jpg','image/jpeg','https://example.test/excerpt.epub#OEBPS/images/page1.jpg','cached','sha','image/jpeg',120,640,960,'native-zip',NULL);`);
    await handleMcp(archive, init());
    const before = archive.db
      .query<{ n: number }, []>("SELECT total_changes() n")
      .get()!.n;
    const response = await handleMcp(
      archive,
      call(2, "fairy_tail_library", {
        kind: "manga",
        isbn: "9782845999145",
        limit: 1,
      }),
    );
    const result = response!.result as {
      isError: boolean;
      structuredContent: {
        scope: string;
        completeVolumeAvailable: boolean;
        volume: { isbn13: string; previewEan: string };
        pages: { assets: { sourceUrl: string; localUrl: string }[] }[];
      };
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.volume.isbn13).toBe("9782845999145");
    expect(result.structuredContent.volume.previewEan).toBe("9782811614126");
    expect(result.structuredContent.scope).toBe("preview");
    expect(result.structuredContent.completeVolumeAvailable).toBe(false);
    expect(result.structuredContent.pages[0]?.assets[0]?.sourceUrl).toBe(
      "https://example.test/excerpt.epub#OEBPS/images/page1.jpg",
    );
    expect(result.structuredContent.pages[0]?.assets[0]?.localUrl).toBe(
      "/cdn/manga/5",
    );
    expect(
      archive.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n,
    ).toBe(before);
    expect(
      (await handleMcp(
        archive,
        call(3, "fairy_tail_library", { kind: "manga", isbn: "bad" }),
      ))!.error!.code,
    ).toBe(-32602);
    expect(
      (await handleMcp(
        archive,
        call(4, "fairy_tail_library", { kind: "wiki", isbn: "9782845999145" }),
      ))!.error!.code,
    ).toBe(-32602);
  } finally {
    archive.close();
  }
});

test("MCP validates IDs, methods and tool arguments without mutating the corpus", async () => {
  const archive = new Archive(":memory:");
  try {
    expect((await handleMcp(archive, []))!.error!.code).toBe(-32600);
    expect(
      (await handleMcp(archive, {
        jsonrpc: "2.0",
        id: { bad: 1 },
        method: "ping",
      }))!.error!.code,
    ).toBe(-32600);
    expect(
      (await handleMcp(archive, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }))!.error!.code,
    ).toBe(-32002);
    await handleMcp(archive, init());
    expect(
      (await handleMcp(archive, { jsonrpc: "2.0", id: 2, method: "missing" }))!
        .error!.code,
    ).toBe(-32601);
    for (const message of [
      call(3, "fairy_tail_context", { chunk_id: 1.2 }),
      call(4, "fairy_tail_search", { query: " " }),
      call(5, "fairy_tail_books", { limit: 101 }),
      call(6, "fairy_tail_ask", { question: "Natsu", lang: "xx" }),
      call(7, "not_a_tool"),
      call(8, "fairy_tail_context", { chunk_id: 1, path: "../../secret" }),
    ])
      expect((await handleMcp(archive, message))!.error!.code).toBe(-32602);
    const changes = archive.db
      .query<{ n: number }, []>("SELECT total_changes() n")
      .get()!.n;
    for (const name of [
      "fairy_tail_coverage",
      "fairy_tail_books",
      "fairy_tail_media",
      "fairy_tail_fancaps",
    ]) {
      const response = await handleMcp(archive, call(10, name));
      expect((response!.result as { isError: boolean }).isError).toBe(false);
    }
    expect(
      archive.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n,
    ).toBe(changes);
    expect(
      archive.db
        .query("SELECT name FROM sqlite_master WHERE name='publisher_queue'")
        .get(),
    ).toBe(null);
  } finally {
    archive.close();
  }
});

test("MCP returns exact context provenance and standard missing-chunk tool errors", async () => {
  const archive = new Archive(":memory:");
  try {
    archive.ingest(
      "https://example.test/natsu",
      "Natsu",
      "Natsu utilise le feu.",
      "fr",
    );
    const chunk = archive.db
      .query<{ id: number }, []>("SELECT id FROM chunks")
      .get()!.id;
    await handleMcp(archive, init());
    const response = await handleMcp(
      archive,
      call(2, "fairy_tail_context", { chunk_id: chunk }),
    );
    const result = response!.result as {
      structuredContent: { url: string; language: string; text: string };
      content: { text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.url).toBe("https://example.test/natsu");
    expect(result.structuredContent.language).toBe("fr");
    expect(JSON.parse(result.content[0]!.text).text).toBe(
      "Natsu utilise le feu.",
    );
    expect(
      (
        (await handleMcp(
          archive,
          call(3, "fairy_tail_context", { chunk_id: 999 }),
        ))!.result as { isError: boolean }
      ).isError,
    ).toBe(true);
  } finally {
    archive.close();
  }
});

test("MCP search reuses the qualified native RAG ranking without writing index state", async () => {
  const archive = new Archive(":memory:");
  try {
    archive.ingest(
      "local:natsu",
      "Natsu Dragnir",
      "Natsu utilise le feu.",
      "fr",
    );
    await handleMcp(archive, init());
    const before = archive.db
      .query<{ n: number }, []>("SELECT total_changes() n")
      .get()!.n;
    const response = await handleMcp(
      archive,
      call(2, "fairy_tail_search", { query: "Natsu", lang: "fr", limit: 2 }),
    );
    const result = response!.result as {
      isError: boolean;
      structuredContent: {
        mode: string;
        ranking: string;
        hits: { title: string }[];
      };
    };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.mode).toBe("lexical");
    expect(result.structuredContent.ranking).toBe("aphrody-rag-core");
    expect(result.structuredContent.hits[0]?.title).toBe("Natsu Dragnir");
    expect(
      archive.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n,
    ).toBe(before);
  } finally {
    archive.close();
  }
}, 10000);

test("MCP stdio handles UTF-8 split across chunks, parse errors and overlong lines", async () => {
  const archive = new Archive(":memory:");
  const input = new TextEncoder().encode(
    [
      JSON.stringify(init()),
      "{bad json}",
      JSON.stringify({ jsonrpc: "2.0", id: "ナツ", method: "ping" }),
      "x".repeat(1024 * 1024 + 1),
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" }),
    ].join("\n") + "\n",
  );
  let position = 0;
  const output: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position === input.length) {
        controller.close();
        return;
      }
      const size = Math.min(127, input.length - position);
      controller.enqueue(input.slice(position, position + size));
      position += size;
    },
  });
  await serveMcp(archive, stream, async (line) => {
    output.push(line);
  });
  const messages = output.map((line) => JSON.parse(line));
  expect(messages).toHaveLength(5);
  expect(messages[1].error.code).toBe(-32700);
  expect(messages[2].id).toBe("ナツ");
  expect(messages[3].error.code).toBe(-32600);
  expect(messages[4].result).toEqual({});
});

test("real Bun MCP subprocess has clean JSON-RPC stdout and closes on stdin EOF", async () => {
  mkdirSync("data", { recursive: true });
  const root = mkdtempSync(resolve("data/mcp-test-"));
  try {
    const database = resolve(root, "archive.sqlite");
    const archive = new Archive(database);
    archive.ingest(
      "https://example.test/lucy",
      "Lucy",
      "Lucy invoque des esprits.",
      "fr",
    );
    const id = archive.db
      .query<{ id: number }, []>("SELECT id FROM chunks")
      .get()!.id;
    archive.close();
    const lines = [
      init(),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, "fairy_tail_context", { chunk_id: id }),
      call(4, "fairy_tail_coverage"),
    ];
    const child = Bun.spawn(["bun", "apps/mcp/main.ts"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: new Blob([
        lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
      ]),
      env: { ...Bun.env, ARCHIVE_DB: database },
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      const messages = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(messages).toHaveLength(4);
      expect(messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(messages[2].result.structuredContent.title).toBe("Lucy");
      expect(messages[3].result.structuredContent.stats.documents).toBe(1);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

function animeFixture(a: Archive) {
  a.db
    .run(`CREATE TABLE anime_works(id TEXT PRIMARY KEY,url TEXT,title TEXT,kind TEXT,language TEXT,advertised_episodes INTEGER,audit_json TEXT);
    CREATE TABLE anime_episodes(work_id TEXT,url TEXT,title TEXT,number INTEGER,season INTEGER,source_url TEXT);
    CREATE TABLE anime_relations(work_id TEXT,target_url TEXT,relation TEXT,source_url TEXT);
    INSERT INTO anime_works VALUES('aaaaaaaaaaaaaaaaaaaaaaaa','https://example.test/fairy-tail/','Fairy Tail','series','fr',2,'{"mismatch":true}');
    INSERT INTO anime_episodes VALUES('aaaaaaaaaaaaaaaaaaaaaaaa','https://example.test/ep-1','Épisode 1',1,NULL,'https://example.test/fairy-tail/');
    INSERT INTO anime_relations VALUES('aaaaaaaaaaaaaaaaaaaaaaaa','https://example.test/film','observed-link','https://example.test/fairy-tail/');
    CREATE TABLE anime_arcs(id TEXT PRIMARY KEY,title TEXT,language TEXT,source_url TEXT,arc_url TEXT,revision INTEGER,source_order INTEGER,naming TEXT,range_kind TEXT,raw_range TEXT,first_episode INTEGER,last_episode INTEGER,episode_numbers TEXT,episode_namespace TEXT,declared_episode_count INTEGER,qualification TEXT,work_id TEXT,fetched_at TEXT);
    INSERT INTO anime_arcs VALUES('bbbbbbbbbbbbbbbbbbbbbbbb','Arc témoin','fr','https://example.test/wiki/Arcs',NULL,42,0,'community_unofficial','anime_episode_links','*[[Épisode 1]]',1,1,'[1]','Fairy Tail',2,'declared_count_mismatch',NULL,'2026-10-25');`);
}
test("MCP anime catalogue actions validate selectors and read absent tables without DDL", async () => {
  const a = new Archive(":memory:");
  try {
    await handleMcp(a, init());
    const before = a.db
      .query("SELECT name,sql FROM sqlite_master ORDER BY name")
      .all();
    for (const kind of ["anime_works", "anime_arcs", "anime_catalog_status"]) {
      const r = await handleMcp(a, call(2, "fairy_tail_library", { kind }));
      expect((r!.result as { isError: boolean }).isError).toBe(false);
    }
    expect(
      a.db.query("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
    ).toEqual(before);
    for (const args of [
      { kind: "anime_work" },
      { kind: "anime_work", work_id: "../bad" },
      { kind: "anime_work", work_id: "a".repeat(25) },
      { kind: "anime_arcs", lang: "und" },
      { kind: "anime_arcs", offset: 100001 },
      { kind: "anime_works", lang: "fr" },
      { kind: "anime_arcs", work_id: "a".repeat(24) },
      { kind: "wiki", work_id: "a".repeat(24) },
      { kind: "anime_catalog_status", q: "anything" },
      { kind: "anime_works", limit: 101 },
    ])
      expect(
        (await handleMcp(a, call(3, "fairy_tail_library", args)))!.error?.code,
      ).toBe(-32602);
    animeFixture(a);
    const changes = a.db
      .query<{ n: number }, []>("SELECT total_changes() n")
      .get()!.n;
    const schema = a.db
      .query<{ schema_version: number }, []>("PRAGMA schema_version")
      .get()!.schema_version;
    const work = await handleMcp(
      a,
      call(4, "fairy_tail_library", {
        kind: "anime_work",
        work_id: "a".repeat(24),
        limit: 1,
      }),
    );
    const value = (
      work!.result as {
        structuredContent: {
          work: { title: string };
          episodes: { number: number }[];
          relations: { relation: string }[];
        };
      }
    ).structuredContent;
    expect(value.work.title).toBe("Fairy Tail");
    expect(value.episodes[0]?.number).toBe(1);
    expect(value.relations[0]?.relation).toBe("observed-link");
    const arcs = await handleMcp(
      a,
      call(5, "fairy_tail_library", {
        kind: "anime_arcs",
        lang: "fr",
        limit: 1,
      }),
    );
    expect(
      (
        arcs!.result as {
          structuredContent: {
            items: {
              qualification: string;
              revision: number;
              episodeNumbers: number[];
            }[];
          };
        }
      ).structuredContent.items[0],
    ).toEqual({
      id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Arc témoin",
      language: "fr",
      sourceUrl: "https://example.test/wiki/Arcs",
      arcUrl: null,
      revision: 42,
      sourceOrder: 0,
      naming: "community_unofficial",
      rangeKind: "anime_episode_links",
      rawRange: "*[[Épisode 1]]",
      firstEpisode: 1,
      lastEpisode: 1,
      episodeNumbers: [1],
      episodeNamespace: "Fairy Tail",
      declaredEpisodeCount: 2,
      qualification: "declared_count_mismatch",
      workId: null,
      fetchedAt: "2026-10-25",
    });
    expect(
      a.db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n,
    ).toBe(changes);
    expect(
      a.db.query<{ schema_version: number }, []>("PRAGMA schema_version").get()!
        .schema_version,
    ).toBe(schema);
  } finally {
    a.close();
  }
});
test("real MCP stdio exposes anime catalogue fields using the same nine tools", async () => {
  mkdirSync("data", { recursive: true });
  const root = mkdtempSync(resolve("data/mcp-anime-test-"));
  try {
    const database = resolve(root, "archive.sqlite");
    const a = new Archive(database);
    animeFixture(a);
    a.close();
    const lines = [
      init(),
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, "fairy_tail_library", { kind: "anime_works", limit: 1 }),
      call(4, "fairy_tail_library", {
        kind: "anime_work",
        work_id: "a".repeat(24),
        limit: 1,
      }),
      call(5, "fairy_tail_library", { kind: "anime_arcs", lang: "fr" }),
      call(6, "fairy_tail_library", { kind: "anime_catalog_status" }),
    ];
    const child = Bun.spawn(["bun", "apps/mcp/main.ts"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: new Blob([lines.map((x) => JSON.stringify(x)).join("\n") + "\n"]),
      env: { ...Bun.env, ARCHIVE_DB: database },
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      const messages = stdout
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      expect(messages.length).toBe(6);
      expect(messages[1].result.tools.length).toBe(9);
      expect(
        messages[1].result.tools[8].inputSchema.properties.kind.enum.includes(
          "anime_arcs",
        ),
      ).toBe(true);
      expect(
        messages[2].result.structuredContent.items[0].listed_episodes,
      ).toBe(1);
      expect(messages[3].result.structuredContent.episodes[0].source_url).toBe(
        "https://example.test/fairy-tail/",
      );
      expect(messages[4].result.structuredContent.items[0].qualification).toBe(
        "declared_count_mismatch",
      );
      expect(messages[5].result.structuredContent.mediaAcquired).toBe(false);
      expect(messages[5].result.structuredContent.exhaustive).toBe(false);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
