import { test, expect } from "bun:test";
import { Archive, similarity, plainText } from "../packages/archive/index.ts";
import { robotsAllowed } from "../packages/crawler/index.ts";
import { ask, questionLanguage } from "../packages/rag/index.ts";
import { createServer } from "../apps/api/main.ts";

test("FTS, accents, typo retrieval and replacement remove stale chunks", () => {
  const a = new Archive(":memory:");
  try {
    a.ingest(
      "https://example.test/natsu",
      "Natsu Dragnir",
      "Natsu utilise la magie du feu. Il appartient à Fairy Tail.",
    );
    expect(a.search("magie")[0]?.title).toBe("Natsu Dragnir");
    expect(a.search("Natsu Dragnr")[0]?.title).toBe("Natsu Dragnir");
    a.ingest(
      "https://example.test/natsu",
      "Été",
      "Lucy est une constellationniste.",
    );
    expect(a.search("magie")).toHaveLength(0);
    expect(a.search("ete")[0]?.title).toBe("Été");
    expect(a.stats().documents).toBe(1);
    expect(a.search('" OR * --')).toEqual([]);
    expect(similarity("", "a")).toBe(0);
  } finally {
    a.close();
  }
});

test("Python RAG returns cited evidence and abstains on empty corpus", async () => {
  const a = new Archive(":memory:");
  try {
    expect((await ask(a, "Qui est Natsu ?")).sources).toEqual([]);
    a.ingest(
      "https://example.test/natsu",
      "Natsu",
      "Natsu utilise la magie du feu.",
    );
    const result = await ask(a, "Quelle magie utilise Natsu ?");
    expect(result.answer).toContain("magie du feu");
    expect(result.answer).toContain("[1]");
    expect(result.sources[0]?.url).toBe("https://example.test/natsu");
    // Quoted input must remain data across the language boundary.
    await ask(a, "Natsu '\" \\ 🐉");
  } finally {
    a.close();
  }
}, 20000);

test("robots exclusion is honored", () => {
  expect(robotsAllowed("User-agent: *\nDisallow: /api.php", "/api.php")).toBe(
    false,
  );
  expect(robotsAllowed("User-agent: *\nDisallow: /wiki/", "/api.php")).toBe(
    true,
  );
});

test("Japanese content retrieval and language filter", async () => {
  const a = new Archive(":memory:");
  try {
    a.ingest(
      "local:ja",
      "ナツ・ドラグニル",
      "ナツは火の魔法を使う魔導士です。ルーシィは星霊魔導士です。",
      "ja",
    );
    a.ingest("local:fr", "Natsu", "Natsu utilise le feu.", "fr");
    expect(a.search("火の魔法", 10, "ja")[0]?.language).toBe("ja");
    expect(a.search("Natsu", 10, "ja")).toHaveLength(0);
    expect((await ask(a, "ナツの魔法は？")).answer).toContain("火の魔法");
  } finally {
    a.close();
  }
});

test("local API serves search and validates frame pagination", async () => {
  const a = new Archive(":memory:");
  a.ingest(
    "https://example.test/lucy",
    "Lucy",
    "Lucy invoque des esprits stellaires.",
  );
  const server = createServer(a, 0);
  try {
    const response = await fetch(new URL("/search?q=Lucy", server.url));
    expect(response.status).toBe(200);
    expect((await response.json())[0].title).toBe("Lucy");
    expect(
      (
        await fetch(
          new URL(
            "/episodes/aaaaaaaaaaaaaaaaaaaaaaaa/frames?offset=-1",
            server.url,
          ),
        )
      ).status,
    ).toBe(400);
  } finally {
    server.stop(true);
    a.close();
  }
});

test("retrieval indexes visible prose and favors an entity over repeated link targets", async () => {
  const a = new Archive(":memory:");
  try {
    const url = "https://example.test/natsu";
    const source =
      "## Natsu\n\n**Natsu Dragnir** est un chasseur de dragons de feu de la guilde Fairy Tail.\n\nIl possède une écharpe blanche.";
    a.ingest(url, "Natsu Dragnir", source, "fr");
    a.ingest(
      "https://example.test/episodes",
      "Liste des épisodes de Fairy Tail",
      Array.from(
        { length: 30 },
        (_, i) =>
          `- [Combat ${i}](https://example.test/Natsu_Dragnir_natsu_dragnir_${i})`,
      ).join("\n"),
      "fr",
    );
    a.ingest(
      "https://example.test/scenes",
      "Natsu dans les épisodes",
      "Natsu ramène son ami au village. Il se demande qui est son adversaire.",
      "fr",
    );
    expect(a.search("Natsu Dragnr")[0]?.url).toBe(url);
    expect(a.search("qui est Natsu")[0]?.url).toBe(url);
    expect(
      a.db
        .query<{ text: string }, [string]>(
          "SELECT text FROM documents WHERE url=?",
        )
        .get(url)!.text,
    ).toBe(source);
    expect(plainText("[Nom](https://example.test/A_(B))")).toBe("Nom");
    const answer = await ask(a, "Qui est Natsu ?");
    expect(
      answer.answer.startsWith("Natsu Dragnir est un chasseur de dragons"),
    ).toBe(true);
    expect(answer.sources[0]?.url).toBe(url);
  } finally {
    a.close();
  }
});

test("explicit reindex cleans old chunks without changing source timestamps", () => {
  const a = new Archive(":memory:");
  try {
    a.ingest("local:test", "Lucy", "Lucy est une mage.");
    a.db
      .query("UPDATE documents SET text=?, fetched_at='2000-01-01' WHERE url=?")
      .run(
        "Lucy est une [constellationniste](https://example.test/secreturltoken).",
        "local:test",
      );
    expect(a.reindex()).toBe(1);
    expect(a.search("constellationniste")[0]?.text).toContain(
      "constellationniste",
    );
    expect(a.search("secreturltoken")).toHaveLength(0);
    expect(
      a.db
        .query<{ fetched_at: string }, []>("SELECT fetched_at FROM documents")
        .get()!.fetched_at,
    ).toBe("2000-01-01");
  } finally {
    a.close();
  }
});

test("RAG chooses question language and excludes FAQ questions and alternate-language entities", async () => {
  const a = new Archive(":memory:");
  try {
    a.ingest(
      "local:en",
      "Natsu Dragion",
      "Natsu Dragion is an Edolas citizen.",
      "en",
    );
    a.ingest(
      "local:fr",
      "Natsu Dragnir",
      "Natsu Dragnir est un chasseur de dragons de feu de Fairy Tail.",
      "fr",
    );
    a.ingest(
      "local:faq",
      "Natsu FAQ",
      "Qui est Natsu ? Qui est Natsu Dragnir ?",
      "fr",
    );
    const french = await ask(a, "Qui est Natsu ?");
    expect(french.answer.startsWith("Natsu Dragnir est un chasseur")).toBe(
      true,
    );
    expect(french.answer.includes("?")).toBe(false);
    expect(french.sources.every((source) => source.url === "local:fr")).toBe(
      true,
    );
    expect((await ask(a, "Who is Natsu?")).sources[0]?.url).toBe("local:en");
    expect((await ask(a, "Qui est Natsu ?", "en")).sources[0]?.url).toBe(
      "local:en",
    );
    expect(questionLanguage("Natsu")).toBe(undefined);
    expect(questionLanguage("ナツとは？")).toBe("ja");
  } finally {
    a.close();
  }
});

test("RAG resolves ambiguous names from main-subject evidence and keeps explicit variants", async () => {
  const a = new Archive(":memory:");
  try {
    a.ingest(
      "local:variant",
      "Aster Argent",
      "Aster Argent est un mage. Il est la version alternative d'Aster Soleil.\n\n## Apparence\nAster est un homme musclé.",
      "fr",
    );
    a.ingest(
      "local:main",
      "Aster Soleil",
      "Une note éditoriale précède cette notice.\n\nAster Soleil est un mage voyageur et le principal protagoniste de cette série.\n\n## Apparence\nAster est un jeune homme mince de taille moyenne.\n" +
        "Aster traverse des villages. ".repeat(200),
      "fr",
    );
    a.ingest(
      "local:disambiguation",
      "Aster",
      "Cette page d'homonymie répertorie plusieurs sujets.\n- Aster Soleil, personnage principal de la série.\n- Aster Argent, alter-ego d'Aster Soleil.",
      "fr",
    );
    const main = await ask(a, "Qui est Aster ?", "fr");
    expect(main.sources[0]?.url).toBe("local:main");
    expect(main.answer.startsWith("Aster Soleil est un mage voyageur")).toBe(
      true,
    );
    expect(main.answer.includes("mince")).toBe(false);
    const variant = await ask(a, "Qui est Aster Argent ?", "fr");
    expect(variant.sources[0]?.url).toBe("local:variant");
    expect(variant.answer.startsWith("Aster Argent est un mage")).toBe(true);
    // Resolving an entity remains read-only and citations use its leading chunk.
    expect(main.sources[0]?.id).toBe(
      a.db
        .query<{ id: number }, [string]>(
          "SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.url=? AND ordinal=0",
        )
        .get("local:main")!.id,
    );
  } finally {
    a.close();
  }
});
