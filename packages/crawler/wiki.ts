import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { withCollectorLease } from "../archive/index.ts";

export const wikiSources = [
  {
    id: "fandom-fr",
    language: "fr",
    api: "https://fairy-tail.fandom.com/fr/api.php",
    articlePath: "/fr/wiki/$1",
    queries: ["Natsu Dragnir", "Lucy Heartfilia", "Guilde Fairy Tail"],
  },
  {
    id: "fandom-en",
    language: "en",
    api: "https://fairytail.fandom.com/api.php",
    articlePath: "/wiki/$1",
    queries: ["Natsu Dragneel", "Lucy Heartfilia", "Fairy Tail Guild"],
  },
  {
    id: "wikipedia-ja",
    language: "ja",
    api: "https://ja.wikipedia.org/w/api.php",
    articlePath: "/wiki/$1",
    queries: ["FAIRY TAIL"],
  },
];

async function output(stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit)
      throw new Error(`Sortie Aphrody supérieure à ${limit} octets`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function aphrodyWeb(
  args: string[],
  timeoutMs = 120000,
): Promise<unknown> {
  const child = Bun.spawn(["aphrody", "web", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      output(child.stdout, 128 * 1024 * 1024),
      output(child.stderr, 1024 * 1024),
      child.exited,
    ]);
    if (timedOut)
      throw new Error(`Aphrody Web : délai dépassé (${timeoutMs} ms)`);
    if (code !== 0)
      throw new Error(`Aphrody Web (${code}): ${stderr.slice(0, 2000)}`);
    return JSON.parse(stdout);
  } catch (e) {
    child.kill();
    await child.exited;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type WikiPage = {
  url: string;
  titre?: string;
  title?: string;
  markdown: string;
  revid?: number;
  pageId?: number;
  wikitext?: string;
};

function wikiState(archive: Archive) {
  archive.db.run(`
    CREATE TABLE IF NOT EXISTS wiki_queries(source TEXT NOT NULL,query TEXT NOT NULL,PRIMARY KEY(source,query));
    CREATE TABLE IF NOT EXISTS wiki_jobs(source TEXT NOT NULL,url TEXT NOT NULL,language TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,raw_path TEXT,
      PRIMARY KEY(source,url));
  `);
  const columns = archive.db
    .query<{ name: string }, []>("PRAGMA table_info(wiki_jobs)")
    .all();
  if (!columns.some((c) => c.name === "depth"))
    archive.db.run(
      "ALTER TABLE wiki_jobs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0",
    );
  if (!columns.some((c) => c.name === "last_run"))
    archive.db.run("ALTER TABLE wiki_jobs ADD COLUMN last_run TEXT");
}
export function importWikiPage(
  archive: Archive,
  page: WikiPage,
  language: string,
) {
  const title = page.titre ?? page.title;
  if (
    typeof title !== "string" ||
    typeof page.markdown !== "string" ||
    !page.markdown.trim()
  )
    throw new Error("Page MediaWiki vide ou invalide");
  const url = new URL(page.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !wikiSources.some((s) => new URL(s.api).origin === url.origin)
  )
    throw new Error("Origine MediaWiki non configurée");
  archive.db.run(
    "CREATE TABLE IF NOT EXISTS wiki_provenance(url TEXT PRIMARY KEY,revid INTEGER,page_id INTEGER,imported_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  );
  archive.db.transaction(() => {
    const previous = archive.db
      .query<{ text: string }, [string]>(
        "SELECT text FROM documents WHERE url=?",
      )
      .get(page.url);
    archive.ingest(page.url, title, page.markdown, language);
    archive.db
      .query(
        `INSERT INTO wiki_provenance(url,revid,page_id) VALUES(?,?,?)
         ON CONFLICT(url) DO UPDATE SET
         revid=CASE WHEN ? THEN coalesce(excluded.revid,wiki_provenance.revid) ELSE excluded.revid END,
         page_id=coalesce(excluded.page_id,wiki_provenance.page_id),
         imported_at=CURRENT_TIMESTAMP`,
      )
      .run(
        page.url,
        page.revid ?? null,
        page.pageId ?? null,
        previous?.text === page.markdown,
      );
  })();
}

// Native Wiki search and page dossiers seed the corpus with central entities first.
export async function seedWiki(
  archive: Archive,
  options: {
    run?: typeof aphrodyWeb;
    outputRoot?: string;
    delayMs?: number;
    sourceIds?: string[];
    refresh?: boolean;
    queries?: Record<string, string[]>;
    searchLimit?: number;
  } = {},
) {
  const run = options.run ?? aphrodyWeb;
  const root = options.outputRoot ?? "data/wiki";
  const limit = options.searchLimit ?? 3;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("searchLimit: entier entre 1 et 100");
  wikiState(archive);
  const report = [];
  const selected = wikiSources.filter(
    (source) => !options.sourceIds || options.sourceIds.includes(source.id),
  );
  if (!selected.length)
    throw new Error("Aucune source Wiki configurée sélectionnée");
  for (const source of selected) {
    let imported = 0;
    const errors: string[] = [];
    mkdirSync(resolve(root, source.id), { recursive: true });
    if (options.refresh) {
      archive.db
        .query("DELETE FROM wiki_queries WHERE source=?")
        .run(source.id);
      archive.db
        .query("UPDATE wiki_jobs SET state='pending' WHERE source=?")
        .run(source.id);
    }
    for (const query of options.queries?.[source.id] ?? source.queries) {
      const queryKey = JSON.stringify([query, limit]);
      if (
        archive.db
          .query("SELECT 1 FROM wiki_queries WHERE source=? AND query=?")
          .get(source.id, queryKey)
      )
        continue;
      try {
        const hits = (await run([
          "wiki-search",
          source.api,
          query,
          "--limit",
          String(limit),
          "--json",
        ])) as { url: string; titre: string }[];
        if (!Array.isArray(hits))
          throw new Error("Réponse wiki-search sans liste de pages");
        archive.db.transaction(() => {
          for (const hit of hits) {
            if (
              typeof hit.url !== "string" ||
              new URL(hit.url).origin !== new URL(source.api).origin ||
              new URL(hit.url).username ||
              new URL(hit.url).password
            )
              throw new Error("Résultat Wiki hors de son origine");
            archive.db
              .query(
                "INSERT OR IGNORE INTO wiki_jobs(source,url,language) VALUES(?,?,?)",
              )
              .run(source.id, hit.url, source.language);
          }
          archive.db
            .query("INSERT INTO wiki_queries(source,query) VALUES(?,?)")
            .run(source.id, queryKey);
        })();
      } catch (e) {
        errors.push(`${query}: ${String(e)}`);
      }
    }
    const jobs = archive.db
      .query<{ url: string }, [string]>(
        "SELECT url FROM wiki_jobs WHERE source=? AND state!='done' ORDER BY rowid",
      )
      .all(source.id);
    for (const job of jobs) {
      archive.db
        .query(
          "UPDATE wiki_jobs SET attempts=attempts+1 WHERE source=? AND url=?",
        )
        .run(source.id, job.url);
      try {
        const page = (await run([
          "wiki-page",
          "--api-url",
          source.api,
          job.url,
          "--include-content",
          "--no-images",
          "--json",
        ])) as WikiPage;
        if (new URL(page.url).origin !== new URL(source.api).origin)
          throw new Error("Dossier Wiki hors de son origine");
        const name = new Bun.CryptoHasher("sha256")
          .update(job.url)
          .digest("hex");
        const path = resolve(root, source.id, `${name}.json`);
        await Bun.write(path, JSON.stringify(page));
        archive.db.transaction(() => {
          importWikiPage(archive, page, source.language);
          archive.db
            .query(
              "UPDATE wiki_jobs SET state='done',last_error=NULL,raw_path=? WHERE source=? AND url=?",
            )
            .run(path, source.id, job.url);
        })();
        imported++;
      } catch (e) {
        const message = String(e);
        errors.push(`${job.url}: ${message}`);
        archive.db
          .query(
            "UPDATE wiki_jobs SET state='failed',last_error=? WHERE source=? AND url=?",
          )
          .run(message, source.id, job.url);
      }
      await Bun.sleep(options.delayMs ?? 1000);
    }
    const pending = archive.db
      .query<{ n: number }, [string]>(
        "SELECT count(*) n FROM wiki_jobs WHERE source=? AND state!='done'",
      )
      .get(source.id)!.n;
    const item = {
      source: source.id,
      language: source.language,
      imported,
      pending,
      errors,
    };
    report.push(item);
    console.error(JSON.stringify(item));
    await Bun.write(
      resolve(root, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  return { report, stats: archive.stats() };
}

type WikiSource = (typeof wikiSources)[number];

function wikiUrl(
  source: WikiSource,
  address: string,
  base?: string,
): string | null {
  try {
    const url = new URL(address, base ?? source.api);
    const prefix = source.articlePath.split("$1")[0]!;
    if (
      url.protocol !== "https:" ||
      url.origin !== new URL(source.api).origin ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.startsWith(prefix)
    )
      return null;
    const title = decodeURIComponent(url.pathname.slice(prefix.length))
      .replace(/^:/, "")
      .replaceAll(" ", "_");
    if (
      !title ||
      /^(?:category|file|image|template|talk|discussion|user|user_talk|help|special|mediawiki|forum|message_wall|thread|blog|catégorie|fichier|modèle|utilisateur|aide|spécial|portail|projet|wikipedia|wikipédia|ファイル|カテゴリ|テンプレート|ノート|利用者|ヘルプ|特別|w|commons|en|fr|ja):/iu.test(
        title,
      )
    )
      return null;
    if (
      source.id === "wikipedia-ja" &&
      !/fairy[ _-]?tail|フェアリーテイル/iu.test(title)
    )
      return null;
    const encoded = title
      .split("/")
      .map((part) =>
        encodeURIComponent(part).replace(
          /[!'()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join("/");
    return `${url.origin}${prefix}${encoded}`;
  } catch {
    return null;
  }
}

export function wikiLinks(
  sourceId: string,
  text: string,
  base: string,
): string[] {
  const source = wikiSources.find((s) => s.id === sourceId);
  if (!source) return [];
  const result = new Set<string>();
  // Balanced Markdown targets retain article names containing parentheses.
  for (const match of text.matchAll(/\[[^\]\r\n]*\]\(/g)) {
    const start = match.index! + match[0].length;
    let depth = 1,
      end = start;
    while (end < text.length && depth > 0) {
      if (text[end] === "\\") {
        end += 2;
        continue;
      }
      if (text[end] === "(") depth++;
      if (text[end] === ")") depth--;
      if (depth > 0) end++;
    }
    if (depth === 0) {
      const target = text.slice(start, end).trim().replace(/^<|>$/g, "");
      const url = wikiUrl(source, target, base);
      if (url) result.add(url);
    }
  }
  const prefix = source.articlePath.split("$1")[0]!;
  for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    let title = match[1]!.split("#")[0]!.trim();
    if (!title) continue;
    if (title.startsWith("/")) {
      const parent = wikiUrl(source, base);
      if (!parent) continue;
      title =
        decodeURIComponent(new URL(parent).pathname.slice(prefix.length)) +
        title;
    }
    const target = `${new URL(source.api).origin}${prefix}${title.split("/").map(encodeURIComponent).join("/")}`;
    const url = wikiUrl(source, target);
    if (url) result.add(url);
  }
  return [...result];
}

export async function crawlWiki(
  archive: Archive,
  options: Parameters<typeof crawlWikiOwned>[1] = {},
) {
  const selected = wikiSources.filter(
    (source) => !options.sourceIds || options.sourceIds.includes(source.id),
  );
  const enter = (
    index: number,
    checks: (() => void)[],
  ): Promise<Awaited<ReturnType<typeof crawlWikiOwned>>> =>
    index === selected.length
      ? crawlWikiOwned(archive, options, () => {
          for (const check of checks) check();
        })
      : withCollectorLease(archive, `wiki:${selected[index]!.id}`, (check) =>
          enter(index + 1, [...checks, check]),
        );
  return enter(0, []);
}

async function crawlWikiOwned(
  archive: Archive,
  options: {
    maxPages?: number;
    sourceIds?: string[];
    run?: typeof aphrodyWeb;
    outputRoot?: string;
    delayMs?: number;
  } = {},
  assertOwner: () => void = () => {},
) {
  const max = options.maxPages ?? 50;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000)
    throw new Error("maxPages: entier entre 1 et 10000");
  const selected = wikiSources.filter(
    (source) => !options.sourceIds || options.sourceIds.includes(source.id),
  );
  if (!selected.length)
    throw new Error("Aucune source Wiki configurée sélectionnée");
  const run = options.run ?? aphrodyWeb,
    root = options.outputRoot ?? "data/wiki";
  wikiState(archive);
  assertOwner();
  for (const source of selected)
    archive.db
      .query(
        "UPDATE wiki_jobs SET state='failed' WHERE source=? AND state='running'",
      )
      .run(source.id);
  const queueCount = () =>
    archive.db
      .query<{ n: number }, []>("SELECT count(*) n FROM wiki_jobs")
      .get()!.n;
  const before = queueCount();
  const enqueue = (
    source: WikiSource,
    text: string,
    base: string,
    depth: number,
  ) => {
    for (const url of wikiLinks(source.id, text, base))
      archive.db
        .query(
          "INSERT OR IGNORE INTO wiki_jobs(source,url,language,depth) VALUES(?,?,?,?)",
        )
        .run(source.id, url, source.language, depth);
  };
  const markExisting = (source: WikiSource, address: string) => {
    const url = wikiUrl(source, address);
    if (!url) return;
    archive.db
      .query(
        "INSERT INTO wiki_jobs(source,url,language,state) VALUES(?,?,?,'done') ON CONFLICT(source,url) DO UPDATE SET state='done',last_error=NULL",
      )
      .run(source.id, url, source.language);
    if (address !== url)
      archive.db
        .query(
          "UPDATE wiki_jobs SET state='done',last_error=NULL WHERE source=? AND url=?",
        )
        .run(source.id, address);
  };
  // Existing documents and raw dossiers are seeds, never a reason to refetch them.
  const docs = archive.db
    .query<{ url: string; text: string }, []>("SELECT url,text FROM documents")
    .all();
  const existing = new Set<string>();
  for (const source of selected) {
    assertOwner();
    mkdirSync(resolve(root, source.id), { recursive: true });
    for (const doc of docs) {
      const url = wikiUrl(source, doc.url);
      if (!url) continue;
      existing.add(url);
      markExisting(source, doc.url);
      enqueue(source, doc.text, doc.url, 1);
    }
    for await (const file of new Bun.Glob("*.json").scan(
      resolve(root, source.id),
    )) {
      try {
        const page = (await Bun.file(
          resolve(root, source.id, file),
        ).json()) as WikiPage;
        assertOwner();
        const url = wikiUrl(source, page.url);
        if (!url) continue;
        if (!existing.has(url)) {
          importWikiPage(archive, page, source.language);
          existing.add(url);
        }
        markExisting(source, page.url);
        enqueue(
          source,
          `${page.markdown}\n${page.wikitext ?? ""}`,
          page.url,
          1,
        );
      } catch {
        /* A malformed cache file cannot suppress valid database seeds. */
      }
    }
  }
  const runId = crypto.randomUUID();
  const report = selected.map((source) => ({
    source: source.id,
    language: source.language,
    attempted: 0,
    imported: 0,
    pending: 0,
    errors: [] as { url: string; error: string }[],
  }));
  let attempted = 0,
    imported = 0;
  while (attempted < max) {
    let madeProgress = false;
    for (const [index, source] of selected.entries()) {
      assertOwner();
      if (attempted >= max) break;
      const job = archive.db
        .query<{ url: string; depth: number }, [string, string]>(
          "SELECT url,depth FROM wiki_jobs WHERE source=? AND state IN ('pending','failed') AND coalesce(last_run,'')!=? ORDER BY depth,attempts,rowid LIMIT 1",
        )
        .get(source.id, runId);
      if (!job) continue;
      madeProgress = true;
      const item = report[index]!;
      archive.db
        .query(
          "UPDATE wiki_jobs SET attempts=attempts+1,last_run=?,state='running' WHERE source=? AND url=?",
        )
        .run(runId, source.id, job.url);
      attempted++;
      item.attempted++;
      try {
        if (!wikiUrl(source, job.url))
          throw new Error("URL de file hors du périmètre Wiki");
        const page = (await run([
          "wiki-page",
          "--api-url",
          source.api,
          job.url,
          "--include-content",
          "--no-images",
          "--json",
        ])) as WikiPage;
        const returned = wikiUrl(source, page.url);
        assertOwner();
        if (!returned)
          throw new Error("Dossier retourné hors du périmètre Wiki");
        const name = new Bun.CryptoHasher("sha256")
          .update(job.url)
          .digest("hex");
        const path = resolve(root, source.id, `${name}.json`);
        const staged = `${path}.${runId}.tmp`;
        try {
          await Bun.write(staged, JSON.stringify(page));
          archive.db.transaction(() => {
            assertOwner();
            renameSync(staged, path);
            importWikiPage(archive, page, source.language);
            archive.db
              .query(
                "UPDATE wiki_jobs SET state='done',last_error=NULL,raw_path=? WHERE source=? AND url=?",
              )
              .run(path, source.id, job.url);
            markExisting(source, page.url);
            enqueue(
              source,
              `${page.markdown}\n${page.wikitext ?? ""}`,
              page.url,
              job.depth + 1,
            );
          })();
        } finally {
          try {
            unlinkSync(staged);
          } catch {
            /* Already published or write failed. */
          }
        }
        imported++;
        item.imported++;
      } catch (e) {
        assertOwner();
        const error = String(e);
        item.errors.push({ url: job.url, error });
        archive.db
          .query(
            "UPDATE wiki_jobs SET state='failed',last_error=? WHERE source=? AND url=?",
          )
          .run(error, source.id, job.url);
      }
      console.error(
        JSON.stringify({
          source: source.id,
          attempted,
          imported,
          budget: max,
          url: job.url,
        }),
      );
      await Bun.sleep(options.delayMs ?? 1000);
    }
    if (!madeProgress) break;
  }
  for (const item of report)
    item.pending = archive.db
      .query<{ n: number }, [string]>(
        "SELECT count(*) n FROM wiki_jobs WHERE source=? AND state!='done'",
      )
      .get(item.source)!.n;
  const result = {
    attempted,
    imported,
    discovered: queueCount() - before,
    pending: report.reduce((sum, item) => sum + item.pending, 0),
    report,
    exhaustive: false,
    stats: archive.stats(),
  };
  await Bun.write(
    resolve(root, "crawl-report.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

export async function enumerateWiki(
  archive: Archive,
  id: string,
  maxPages = 200,
  prefix?: string,
) {
  const source = wikiSources.find((s) => s.id === id);
  if (!source) throw new Error("Source wiki inconnue");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000)
    throw new Error("Budget de 1 à 10000 pages");
  if (id === "wikipedia-ja" && !prefix) prefix = "FAIRY_TAIL";
  const result = (await aphrodyWeb(
    [
      "mediawiki",
      "--api-url",
      source.api,
      "--article-path",
      source.articlePath,
      "--max-pages",
      String(maxPages),
      "--request-interval-ms",
      "1000",
      ...(prefix ? ["--prefix", prefix] : []),
    ],
    Math.min(1800000, 30000 + maxPages * 5000),
  )) as { pages: WikiPage[] };
  if (!Array.isArray(result.pages))
    throw new Error("Réponse MediaWiki sans pages");
  mkdirSync("data/wiki", { recursive: true });
  const path = resolve(
    "data/wiki",
    `${id}-${new Bun.CryptoHasher("sha256")
      .update(prefix ?? "all")
      .digest("hex")
      .slice(0, 12)}.json`,
  );
  await Bun.write(path, JSON.stringify(result));
  const errors: { url: string; error: string }[] = [];
  let imported = 0;
  for (const page of result.pages) {
    try {
      importWikiPage(archive, page, source.language);
      imported++;
    } catch (e) {
      errors.push({
        url: typeof page?.url === "string" ? page.url : "<invalid>",
        error: String(e),
      });
    }
  }
  const report = {
    source: id,
    requested: maxPages,
    returned: result.pages.length,
    imported,
    errors,
    raw: path,
    exhaustive: false,
  };
  await Bun.write(`${path}.report.json`, JSON.stringify(report, null, 2));
  return {
    source: id,
    imported,
    errors,
    requested: maxPages,
    prefix: prefix ?? "",
    exhaustive: false,
    raw: path,
  };
}
