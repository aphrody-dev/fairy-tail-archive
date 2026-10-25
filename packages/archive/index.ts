import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/([a-z])\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stopwords = new Set(
  "a an and are as at be by do does for from how i in is it of on or the this to was what when where which who why with le la les un une des de du dans en et est sont qui que quel quelle quelles quels comment pourquoi au aux ce ces c il elle son sa ses ne pas".split(
    " ",
  ),
);

export function searchTerms(text: string): string {
  return normalize(text)
    .split(" ")
    .filter((word) => word && !stopwords.has(word))
    .join(" ");
}

/** Keep visible source prose, never Markdown URL targets, in the retrieval index. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g, " ")
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()]*\))*\)/g, "$1")
    .replace(/https?:\/\/[^\s<>]+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, " ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function similarity(a: string, b: string): number {
  a = normalize(a);
  b = normalize(b);
  if (a === b) return 1;
  if (!a || !b) return 0;
  // Dice bigrams retain typo tolerance without a quadratic edit-distance matrix.
  const grams = (s: string) =>
    new Set(
      Array.from({ length: Math.max(1, s.length - 1) }, (_, i) =>
        s.slice(i, i + 2),
      ),
    );
  const x = grams(a),
    y = grams(b);
  let overlap = 0;
  for (const g of x) if (y.has(g)) overlap++;
  return (2 * overlap) / (x.size + y.size);
}

export type Hit = {
  id: number;
  title: string;
  url: string;
  text: string;
  score: number;
  language?: string;
};

export class Archive {
  readonly db: Database;
  constructor(path = Bun.env.ARCHIVE_DB ?? "data/archive.sqlite") {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path, { strict: true });
    this.db.run(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, text TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE(document_id, ordinal));
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunks_fts(rowid,text) VALUES(new.id,new.text); END;
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN INSERT INTO chunks_fts(chunks_fts,rowid,text) VALUES('delete',old.id,old.text); END;
      CREATE TABLE IF NOT EXISTS title_grams(gram TEXT NOT NULL, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, PRIMARY KEY(gram,document_id));
      CREATE TABLE IF NOT EXISTS chunk_grams(gram TEXT NOT NULL, chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, PRIMARY KEY(gram,chunk_id));
      CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL, next_frame INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS frames(episode_id TEXT NOT NULL REFERENCES episodes(id), number INTEGER NOT NULL, time REAL NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(episode_id,number));
    `);
    if (
      !this.db
        .query<{ name: string }, []>("PRAGMA table_info(documents)")
        .all()
        .some((c) => c.name === "language")
    )
      this.db.run(
        "ALTER TABLE documents ADD COLUMN language TEXT NOT NULL DEFAULT 'und'",
      );
  }
  ingest(url: string, title: string, text: string, language = "und") {
    if (!text.trim() || !title.trim())
      throw new Error("Titre et contenu requis");
    return this.db.transaction(() => {
      this.db
        .query(
          "INSERT INTO documents(url,title,text,language) VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,text=excluded.text,language=excluded.language,fetched_at=CURRENT_TIMESTAMP",
        )
        .run(url, title, text, language);
      const doc = this.db
        .query<{ id: number }, [string]>("SELECT id FROM documents WHERE url=?")
        .get(url)!;
      this.indexDocument(doc.id, title, text);
      return doc.id;
    })();
  }
  private indexDocument(id: number, title: string, text: string) {
    this.db.query("DELETE FROM chunks WHERE document_id=?").run(id);
    this.db.query("DELETE FROM title_grams WHERE document_id=?").run(id);
    const words = Array.from(plainText(text));
    const insert = this.db.query(
      "INSERT INTO chunks(document_id,ordinal,text) VALUES(?,?,?)",
    );
    for (
      let start = 0, ordinal = 0;
      start < words.length;
      start += 800, ordinal++
    ) {
      const passage = words.slice(start, start + 1000).join("");
      insert.run(id, ordinal, passage);
      const chunk = this.db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM chunks WHERE document_id=? AND ordinal=?",
        )
        .get(id, ordinal)!;
      for (const gram of cjkGrams(passage))
        this.db
          .query("INSERT OR IGNORE INTO chunk_grams VALUES(?,?)")
          .run(gram, chunk.id);
    }
    const name = normalize(title);
    for (let i = 0; i < name.length - 1; i++)
      this.db
        .query("INSERT OR IGNORE INTO title_grams VALUES(?,?)")
        .run(name.slice(i, i + 2), id);
  }
  /** Explicit migration for older raw-Markdown indexes; source timestamps remain intact. */
  reindex() {
    return this.db.transaction(() => {
      const docs = this.db
        .query<{ id: number; title: string; text: string }, []>(
          "SELECT id,title,text FROM documents",
        )
        .all();
      for (const doc of docs) this.indexDocument(doc.id, doc.title, doc.text);
      return docs.length;
    })();
  }
  search(query: string, limit = 10, language?: string): Hit[] {
    const q = searchTerms(query).slice(0, 256);
    if (!q) return [];
    limit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
    const match = q
      .split(" ")
      .map((t) => `"${t}"`)
      .join(" OR ");
    const exact = this.db
      .query<Hit, [string, string | null, string | null, number]>(
        `SELECT c.id,d.title,d.url,d.language,c.text,-bm25(chunks_fts) AS score FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ? AND (? IS NULL OR d.language=?) ORDER BY bm25(chunks_fts) LIMIT ?`,
      )
      .all(match, language ?? null, language ?? null, Math.max(50, limit * 4));
    const japanese = cjkGrams(q);
    if (japanese.length) {
      exact.push(
        ...this.db
          .query<Hit, (string | number | null)[]>(
            `SELECT c.id,d.title,d.url,d.language,c.text,COUNT(*)*0.1 AS score FROM chunk_grams g JOIN chunks c ON c.id=g.chunk_id JOIN documents d ON d.id=c.document_id WHERE g.gram IN (${japanese.map(() => "?").join(",")}) AND (? IS NULL OR d.language=?) GROUP BY c.id ORDER BY score DESC LIMIT ?`,
          )
          .all(...japanese, language ?? null, language ?? null, limit),
      );
    }
    const grams = [
      ...new Set(
        Array.from({ length: Math.max(0, q.length - 1) }, (_, i) =>
          q.slice(i, i + 2),
        ),
      ),
    ];
    const candidates = grams.length
      ? this.db
          .query<Hit, string[]>(
            `SELECT c.id,d.title,d.url,d.language,c.text,COUNT(*) AS score FROM title_grams g JOIN documents d ON d.id=g.document_id JOIN chunks c ON c.document_id=d.id AND c.ordinal=0 WHERE g.gram IN (${grams.map(() => "?").join(",")}) ${language ? "AND d.language=?" : ""} GROUP BY d.id ORDER BY score DESC LIMIT 100`,
          )
          .all(...grams, ...(language ? [language] : []))
      : [];
    const maxLexical = Math.max(0.000001, ...exact.map((h) => h.score));
    const hits = new Map(
      exact.map((h) => [
        h.id,
        { ...h, score: 0.5 + (0.5 * h.score) / maxLexical },
      ]),
    );
    for (const h of candidates) {
      const title = searchTerms(h.title);
      const queryWords = q.split(" ");
      const wordCoverage =
        queryWords.filter((word) => title.split(" ").includes(word)).length /
        queryWords.length;
      const score = Math.max(
        similarity(q, title),
        wordCoverage *
          0.85 *
          Math.sqrt(
            queryWords.length /
              Math.max(queryWords.length, title.split(" ").length),
          ),
      );
      if (score >= 0.35) {
        // Early prose supplies definitions; lexical hits supply later abilities and events.
        const early = this.db
          .query<Hit, [string]>(
            "SELECT c.id,d.title,d.url,d.language,c.text,0 AS score FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.url=? AND c.ordinal<3 ORDER BY c.ordinal",
          )
          .all(h.url);
        for (let i = 0; i < early.length; i++) {
          const passage = early[i]!;
          const boosted = 3 * score - i * 0.03;
          if (!hits.has(passage.id) || hits.get(passage.id)!.score < boosted)
            hits.set(passage.id, { ...passage, score: boosted });
        }
      }
    }
    const perDocument = new Map<string, number>();
    return [...hits.values()]
      .sort((a, b) => b.score - a.score)
      .filter((hit) => {
        const count = perDocument.get(hit.url) ?? 0;
        if (count >= 3) return false;
        perDocument.set(hit.url, count + 1);
        return true;
      })
      .slice(0, limit);
  }
  stats() {
    return Object.fromEntries(
      ["documents", "chunks", "episodes", "frames"].map((table) => [
        table,
        this.db
          .query<{ n: number }, []>(`SELECT count(*) n FROM ${table}`)
          .get()!.n,
      ]),
    );
  }
  close() {
    this.db.close();
  }
}

/** Cross-process SQLite ownership with expiry and fencing after awaited work. */
export async function withCollectorLease<T>(
  archive: Archive,
  name: string,
  task: (assertOwner: () => void) => Promise<T>,
  ttlMs = 300000,
): Promise<T> {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 100)
    throw new Error("Invalid lease lifetime");
  archive.db.run(
    "CREATE TABLE IF NOT EXISTS collector_leases(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL)",
  );
  const owner = crypto.randomUUID(),
    now = Date.now();
  const acquired = archive.db
    .query<{ owner: string }, [string, string, number, number]>(
      "INSERT INTO collector_leases(name,owner,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE collector_leases.expires_at<=? RETURNING owner",
    )
    .get(name, owner, now + ttlMs, now);
  if (!acquired) throw new Error(`Collector already running: ${name}`);
  let lost = false;
  const assertOwner = () => {
    if (
      lost ||
      !archive.db
        .query(
          "SELECT 1 FROM collector_leases WHERE name=? AND owner=? AND expires_at>?",
        )
        .get(name, owner, Date.now())
    )
      throw new Error(`Collector lease lost: ${name}`);
  };
  const timer = setInterval(
    () => {
      try {
        const time = Date.now();
        if (
          !archive.db
            .query(
              "UPDATE collector_leases SET expires_at=? WHERE name=? AND owner=? AND expires_at>? RETURNING owner",
            )
            .get(time + ttlMs, name, owner, time)
        )
          lost = true;
      } catch {
        lost = true;
      }
    },
    Math.max(25, Math.floor(ttlMs / 3)),
  );
  try {
    const result = await task(assertOwner);
    assertOwner();
    return result;
  } finally {
    clearInterval(timer);
    archive.db
      .query("DELETE FROM collector_leases WHERE name=? AND owner=?")
      .run(name, owner);
  }
}

export function cjkGrams(text: string): string[] {
  const result = new Set<string>();
  for (const match of normalize(text).matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu,
  )) {
    const chars = Array.from(match[0]);
    for (let i = 0; i < chars.length; i++) {
      if (chars.length === 1) result.add(chars[i]!);
      else if (i + 1 < chars.length) result.add(chars[i]! + chars[i + 1]!);
    }
  }
  return [...result];
}
