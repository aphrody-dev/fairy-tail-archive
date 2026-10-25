import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { sources, inScope, type Source } from "./sources.ts";

// The native owner manages HTTP, robots, extraction, leases and the durable frontier.
// This adapter narrows its discovered URLs to Fairy Tail and imports its page store.
function prune(db: Database, source: Source) {
  for (const row of db
    .query<{ url: string }, []>(
      "SELECT url FROM requests WHERE state='pending'",
    )
    .all()) {
    if (!inScope(source, row.url))
      db.query("DELETE FROM requests WHERE url=? AND state='pending'").run(
        row.url,
      );
  }
}

export async function crawlWeb(
  archive: Archive,
  maxRequests = 100,
  selected?: string,
) {
  if (!Bun.Crawl.available)
    throw new Error("Fournisseur natif Bun.Crawl indisponible");
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 10000
  )
    throw new Error("Budget: entier de 1 à 10000");
  const targets = sources.filter((s) => !selected || s.id === selected);
  if (!targets.length) throw new Error("Source inconnue");
  mkdirSync("data/web", { recursive: true });
  archive.db.run(
    "CREATE TABLE IF NOT EXISTS web_imports(url TEXT PRIMARY KEY,content_hash TEXT NOT NULL)",
  );
  const report: {
    source: string;
    language: string;
    imported: number;
    pending: number;
    errors: unknown[];
  }[] = [];
  let remaining = maxRequests;
  for (const source of targets) {
    if (remaining === 0) break;
    const store = resolve("data/web", `${source.id}.sqlite`);
    let imported = 0,
      pending = 0;
    const errors: unknown[] = [];
    const budget = Math.max(
      1,
      Math.floor(remaining / (targets.length - report.length)),
    );
    for (let i = 0; i < budget && remaining > 0; i++) {
      const result = await Bun.Crawl.run({
        action: "run",
        store,
        seeds: source.seeds,
        maxRequests: 1,
        maxSitemaps: 0,
        concurrency: 1,
        timeout: 15000,
      });
      remaining--;
      errors.push(...(result.errors ?? []));
      const db = new Database(store, { strict: true });
      try {
        prune(db, source);
        for (const page of db
          .query<
            {
              url: string;
              title: string;
              markdown: string;
              content_hash: string;
            },
            []
          >("SELECT url,title,markdown,content_hash FROM pages")
          .all()) {
          if (!inScope(source, page.url) || !page.markdown.trim()) continue;
          // A challenge response must never become knowledge in the RAG corpus.
          const detection = Bun.WebDetect.detect({
            url: page.url,
            body: page.markdown,
          });
          if (detection.challenge.provider !== "none") {
            errors.push([page.url, detection.challenge.provider]);
            continue;
          }
          const previous = archive.db
            .query<{ content_hash: string }, [string]>(
              "SELECT content_hash FROM web_imports WHERE url=?",
            )
            .get(page.url);
          if (previous?.content_hash === page.content_hash) continue;
          archive.ingest(page.url, page.title, page.markdown, source.language);
          archive.db
            .query("INSERT OR REPLACE INTO web_imports VALUES(?,?)")
            .run(page.url, page.content_hash);
          imported++;
        }
        pending = db
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM requests WHERE state='pending'",
          )
          .get()!.n;
      } finally {
        db.close();
      }
      if (!pending || result.attempts === 0 || (result.errorCount ?? 0) > 0)
        break;
      await Bun.sleep(1000);
    }
    const item = {
      source: source.id,
      language: source.language,
      imported,
      pending,
      errors,
    };
    report.push(item);
    console.error(JSON.stringify(item));
  }
  await Bun.write(
    "data/web/report.json",
    JSON.stringify(
      { at: new Date().toISOString(), report, stats: archive.stats() },
      null,
      2,
    ),
  );
  return { report, stats: archive.stats(), exhaustive: false };
}

export async function probeWeb(url: string) {
  if (!sources.some((s) => inScope(s, url)))
    throw new Error("URL hors des sources Fairy Tail configurées");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const body = await response.text();
  const detection = Bun.WebDetect.detect({
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body,
  });
  const report: Record<string, unknown> = {
    url,
    http: response.status,
    challenge: detection.challenge,
    curl: Bun.Curl.available,
    crawl: Bun.Crawl.available,
  };
  if (Bun.Curl.available) {
    try {
      const result = await Bun.Curl.request(url, {
        timeout: 15000,
        maxBytes: 4_000_000,
        followRedirects: false,
      });
      report.curlStatus = result.status;
    } catch (e) {
      report.curlError = String(e);
    }
  }
  await using view = new Bun.WebView({
    backend: { type: "chrome", url: false },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    report.browser = await Promise.race([
      (async () => {
        await view.navigate(url);
        await view.evaluate("new Promise(resolve=>setTimeout(resolve,8000))");
        return await view.evaluate(
          "({title:document.title,url:location.href,text:document.body.innerText.slice(0,1200)})",
        );
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Browser deadline: 25s")),
          25000,
        );
      }),
    ]);
  } catch (e) {
    report.browserError = String(e);
  } finally {
    clearTimeout(timer);
  }
  return report;
}
