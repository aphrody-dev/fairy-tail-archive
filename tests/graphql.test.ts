import { test, expect } from "bun:test";
import { handleGraphQL } from "../packages/api-contract/graphql.ts";

const post = (
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
) =>
  new Request("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables, operationName }),
  });

test("GraphQL parses variables, defaults, aliases and projects selected fields", async () => {
  const a = new Archive(":memory:");
  try {
    a.ingest("local:natsu", "Natsu Dragnir", "Natsu est un mage du feu.", "fr");
    const response = await handleGraphQL(
      a,
      post(
        'query Find($needle: String!, $lang: String = "fr") { matches: search(q: $needle, lang: $lang, limit: 5) { title url } stats { documents } __typename }',
        { needle: "Natsu" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        matches: [{ title: "Natsu Dragnir", url: "local:natsu" }],
        stats: { documents: 1 },
        __typename: "Query",
      },
    });
  } finally {
    a.close();
  }
});

test("GraphQL selects a named operation and returns empty absent catalogues", async () => {
  const a = new Archive(":memory:");
  try {
    const response = await handleGraphQL(
      a,
      post(
        "query A { stats { documents } } query B { books { title authors } media { title } episodes { id } }",
        {},
        "B",
      ),
    );
    expect(await response.json()).toEqual({
      data: { books: [], media: [], episodes: [] },
    });
    expect(
      (
        await handleGraphQL(
          a,
          post("query A {stats{documents}} query B{stats{chunks}}"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleGraphQL(a, post("query A{stats{documents}}", {}, "Missing")))
        .status,
    ).toBe(400);
  } finally {
    a.close();
  }
});

test("GraphQL rejects unknown schema fields, invalid variables and invalid syntax", async () => {
  const a = new Archive(":memory:");
  try {
    for (const query of [
      "{ secret }",
      "{ stats { secret } }",
      "{ search {title} }",
      "{ stats(bad: 1) {documents} }",
      "{ stats }",
      "{ stats {documents",
      "mutation {stats{documents}}",
      "{ ...Anything }",
      "query Q($q: Int!) {search(q:$q){title}}",
      "query Q($q: String) {search(q:$q){title}}",
      "{books(limit:0){title}}",
    ]) {
      const response = await handleGraphQL(a, post(query, { q: 1 }));
      expect(response.status).toBe(400);
      const result = await response.json();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Object.hasOwn(result, "data")).toBe(false);
    }
    expect(
      (
        await handleGraphQL(
          a,
          post("query Q($q: String!) {search(q:$q){title}}"),
        )
      ).status,
    ).toBe(400);
  } finally {
    a.close();
  }
});

test("GraphQL handles punctuation in string literals and GET variables as data", async () => {
  const a = new Archive(":memory:");
  try {
    const url = new URL("http://localhost/graphql");
    url.searchParams.set(
      "query",
      "# comment\nquery Find($q:String!){search(q:$q){title}}",
    );
    url.searchParams.set(
      "variables",
      JSON.stringify({ q: 'Natsu "} # literal' }),
    );
    const response = await handleGraphQL(a, new Request(url));
    expect(await response.json()).toEqual({ data: { search: [] } });
    expect(
      (
        await handleGraphQL(
          a,
          new Request("http://localhost/graphql", {
            method: "POST",
            headers: { "content-type": "application/jsonp" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await handleGraphQL(
          a,
          new Request("http://localhost/graphql", { method: "DELETE" }),
        )
      ).status,
    ).toBe(405);
  } finally {
    a.close();
  }
});

test("GraphQL decodes stored book authors and media languages", async () => {
  const a = new Archive(":memory:");
  try {
    a.db
      .run(`CREATE TABLE catalog_books(url TEXT,title TEXT,authors_json TEXT,isbn13 TEXT,published_on TEXT,synopsis TEXT,source_catalog_url TEXT,fetched_at TEXT,details_fetched_at TEXT);
      INSERT INTO catalog_books VALUES('https://example.test/book','Fairy Tail T1','["Hiro Mashima"]','9782811694920','2025-03-05',NULL,'https://example.test/catalog','2026-10-25',NULL);
      CREATE TABLE media_catalog(provider TEXT,source_id TEXT,item_key TEXT,provider_id TEXT,title TEXT,url TEXT,episode_number INTEGER,season_number INTEGER,duration_seconds INTEGER,summary TEXT,audio_languages TEXT,subtitle_languages TEXT);
      INSERT INTO media_catalog VALUES('youtube','channel','item','abcdefghijk','Fairy Tail 1','https://example.test/video',1,NULL,1440,'Résumé','["ja"]','["fr"]');`);
    const response = await handleGraphQL(
      a,
      post(
        '{ books {title authors publishedOn synopsis} media(provider:"youtube"){episode audioLanguages subtitleLanguages episodeId} }',
      ),
    );
    expect(await response.json()).toEqual({
      data: {
        books: [
          {
            title: "Fairy Tail T1",
            authors: ["Hiro Mashima"],
            publishedOn: "2025-03-05",
            synopsis: null,
          },
        ],
        media: [
          {
            episode: 1,
            audioLanguages: ["ja"],
            subtitleLanguages: ["fr"],
            episodeId: null,
          },
        ],
      },
    });
  } finally {
    a.close();
  }
});
import { getIntrospectionQuery } from "../packages/api-contract/node_modules/graphql/index.mjs";
import { Archive } from "../packages/archive/index.ts";
import { graphQLLimits } from "../packages/api-contract/graphql.ts";
const req = (query: string, variables?: unknown) =>
  new Request("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
test("Reference GraphQL supports full introspection, fragments, directives and merging", async () => {
  const a = new Archive(":memory:");
  try {
    const intro = await handleGraphQL(a, req(getIntrospectionQuery()));
    const result = await intro.json();
    expect(intro.status).toBe(200);
    expect(result.errors).toBe(undefined);
    expect(result.data.__schema.queryType.name).toBe("Query");
    const r = await handleGraphQL(
      a,
      req(
        "query Q($yes:Boolean!){stats{documents} stats{...S} ignored:stats @skip(if:$yes){frames} ... on Query{__typename}} fragment S on Stats{chunks}",
        { yes: true },
      ),
    );
    expect(await r.json()).toEqual({
      data: { stats: { documents: 0, chunks: 0 }, __typename: "Query" },
    });
  } finally {
    a.close();
  }
});
test("Reference execution preserves non-null propagation and masks private resolver errors", async () => {
  const a = new Archive(":memory:");
  try {
    a.db.run("DROP TABLE episodes");
    const r = await handleGraphQL(a, req("{episodes{id}}"));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.data).toBe(null);
    expect(body.errors[0].path).toEqual(["episodes"]);
    expect(body.errors[0].message).toBe("GraphQL execution failed");
    expect(JSON.stringify(body).includes("sqlite")).toBe(false);
  } finally {
    a.close();
  }
});
test("GraphQL admission bounds source bytes, tokens, depth, field cost and pagination", async () => {
  const a = new Archive(":memory:");
  try {
    for (const q of [
      "#" + "é".repeat(graphQLLimits.sourceBytes / 2) + "\n{stats{documents}}",
      "{" +
        Array.from({ length: 2200 }, (_, i) => "a" + i + ":__typename").join(
          " ",
        ) +
        "}",
      '{__type(name:"Query"){' +
        "ofType{".repeat(25) +
        "name" +
        "}".repeat(25) +
        "}}",
      "{books(limit:101){title}}",
      '{search(q:"x",limit:51){title}}',
      '{search(q:"x",lang:"private"){title}}',
      "fragment A on Query{...A} query{...A}",
    ])
      expect((await handleGraphQL(a, req(q))).status).toBe(400);
    const leaf = "fragment A on Query{stats{documents}}";
    let fragments = leaf;
    for (let i = 1; i < 20; i++)
      fragments +=
        " fragment " +
        String.fromCharCode(65 + i) +
        " on Query{..." +
        String.fromCharCode(64 + i) +
        " ..." +
        String.fromCharCode(64 + i) +
        "}";
    expect(
      (await handleGraphQL(a, req("query{...T} " + fragments))).status,
    ).toBe(400);
    const oversized = new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "{stats{documents}}",
        padding: "x".repeat(131072),
      }),
    });
    expect((await handleGraphQL(a, oversized)).status).toBe(400);
  } finally {
    a.close();
  }
});
test("Reference GraphQL treats variable prototype keys and aliases as data", async () => {
  const a = new Archive(":memory:");
  try {
    const r = await handleGraphQL(
      a,
      req(
        "query Q($constructor:String!){__proto__:search(q:$constructor){title} constructor:stats{documents}}",
        JSON.parse('{"constructor":"Natsu","__proto__":{"polluted":true}}'),
      ),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      data: { __proto__: [], constructor: { documents: 0 } },
    });
    expect(({} as Record<string, unknown>).polluted).toBe(undefined);
  } finally {
    a.close();
  }
});
