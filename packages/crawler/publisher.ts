import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { plainText, type Archive } from "../archive/index.ts";
import { aphrodyWeb } from "./wiki.ts";

export const publisherSeed = "https://www.pika.fr/livres-fairy-tail/";
export type Book = {
  url: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  publishedOn: string | null;
  synopsis: string | null;
};
type FetchResult = {
  url: string;
  transport: { status: number; final_url: string };
  body: string;
  truncated?: boolean;
};
type Fetcher = (url: string) => Promise<FetchResult>;

export function publisherUrl(
  address: string,
  base = publisherSeed,
): string | null {
  try {
    const url = new URL(address, base);
    if (
      url.origin !== "https://www.pika.fr" ||
      url.username ||
      url.password ||
      url.search
    )
      return null;
    if (
      !/^\/livres-fairy-tail\/(?:[1-9]\d*\/)?$/.test(url.pathname) &&
      !/^\/livre\/[^/]*fairy-tail[^/]*\/$/.test(url.pathname)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function isbn(url: string): string | null {
  const value = /-(97[89]\d{10})\/$/.exec(url)?.[1];
  if (!value) return null;
  const sum = Array.from(value).reduce(
    (n, char, i) => n + Number(char) * (i % 2 ? 3 : 1),
    0,
  );
  return sum % 10 === 0 ? value : null;
}
function date(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().startsWith(iso)
    ? iso
    : null;
}

export function parsePublisherListing(
  body: string,
  url = publisherSeed,
): { books: Book[]; listings: string[] } {
  const headings = [...body.matchAll(/^###\s+\[([^\]\n]+)\]\(([^)\n]+)\)/gm)];
  const books = new Map<string, Book>();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!,
      address = publisherUrl(heading[2]!, url);
    if (!address || !new URL(address).pathname.startsWith("/livre/")) continue;
    const block = body.slice(
      heading.index! + heading[0].length,
      headings[i + 1]?.index ?? body.length,
    );
    const labels = [...block.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)]
      .filter((link) => publisherUrl(link[2]!, url) === address)
      .map((link) => plainText(link[1]!));
    const publishedOn =
      labels.map(date).find((value) => value !== null) ?? null;
    const authors = [
      ...new Set(
        labels.filter(
          (label) =>
            !date(label) &&
            !/^Fairy Tail$|^À paraître$|^Nouveauté$|^remove_red_eye_outlined$|^arrow_/i.test(
              label,
            ),
        ),
      ),
    ];
    books.set(address, {
      url: address,
      title: plainText(heading[1]!),
      authors,
      isbn13: isbn(address),
      publishedOn,
      synopsis: null,
    });
  }
  const listings = new Set<string>();
  for (const link of body.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const address = publisherUrl(link[1]!, url);
    if (address && new URL(address).pathname.startsWith("/livres-fairy-tail/"))
      listings.add(address);
  }
  return { books: [...books.values()], listings: [...listings] };
}

export function parsePublisherBook(body: string, url: string): Book {
  if (!publisherUrl(url) || !new URL(url).pathname.startsWith("/livre/"))
    throw new Error("Fiche Pika hors périmètre");
  const title = /^#\s+(.+)$/m.exec(body)?.[1];
  if (!title) throw new Error("Fiche Pika sans titre");
  if (!/fairy[\s-]*tail/i.test(title))
    throw new Error("Titre de fiche Pika hors sujet ou page de blocage");
  const main = body
    .slice(body.indexOf(`# ${title}`))
    .split(/^##\s+Vous pourriez aimer/m)[0]!;
  const months = [
    "janvier",
    "fevrier",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "aout",
    "septembre",
    "octobre",
    "novembre",
    "decembre",
  ];
  const release = /Sortie le (\d{1,2}) ([\p{L}]+) (\d{4})/u.exec(
    main.normalize("NFD").replace(/\p{M}/gu, ""),
  );
  const month = release ? months.indexOf(release[2]!.toLowerCase()) + 1 : 0;
  const publishedOn =
    release && month
      ? date(
          `${release[1]!.padStart(2, "0")}/${String(month).padStart(2, "0")}/${release[3]}`,
        )
      : null;
  const summary =
    /(?:^|\n)(?:#{1,3}\s*)?Résumé\s*\n([\s\S]*?)(?=\n!\[|\nDétailsAvis|\n#{1,3}\s|$)/.exec(
      main,
    )?.[1];
  const authors = [...main.matchAll(/\[([^\]\n]+)\]\(\/auteur\/[^)]+\)/g)].map(
    (link) => plainText(link[1]!),
  );
  return {
    url,
    title: plainText(title),
    authors: [...new Set(authors)],
    isbn13: isbn(url),
    publishedOn,
    synopsis: summary ? plainText(summary) || null : null,
  };
}

export function initPublisher(archive: Archive) {
  archive.db
    .run(`CREATE TABLE IF NOT EXISTS publisher_queue(url TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,content_hash TEXT,checked_at TEXT);
    CREATE TABLE IF NOT EXISTS catalog_books(url TEXT PRIMARY KEY,title TEXT NOT NULL,authors_json TEXT NOT NULL,isbn13 TEXT,published_on TEXT,synopsis TEXT,source_catalog_url TEXT NOT NULL,fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,details_fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS publisher_lock(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  archive.db
    .query(
      "INSERT OR IGNORE INTO publisher_queue(url,kind) VALUES(?,'listing')",
    )
    .run(publisherSeed);
}

function saveBook(
  archive: Archive,
  book: Book,
  source: string,
  details = false,
) {
  archive.db
    .query(
      `INSERT INTO catalog_books(url,title,authors_json,isbn13,published_on,synopsis,source_catalog_url,details_fetched_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title,authors_json=CASE WHEN excluded.authors_json='[]' THEN catalog_books.authors_json ELSE excluded.authors_json END,isbn13=COALESCE(excluded.isbn13,catalog_books.isbn13),published_on=COALESCE(excluded.published_on,catalog_books.published_on),synopsis=COALESCE(excluded.synopsis,catalog_books.synopsis),fetched_at=CURRENT_TIMESTAMP,details_fetched_at=COALESCE(excluded.details_fetched_at,catalog_books.details_fetched_at)`,
    )
    .run(
      book.url,
      book.title,
      JSON.stringify(book.authors),
      book.isbn13,
      book.publishedOn,
      book.synopsis,
      source,
      details ? new Date().toISOString() : null,
    );
  const row = archive.db
    .query<
      {
        title: string;
        authors_json: string;
        isbn13: string | null;
        published_on: string | null;
        synopsis: string | null;
        source_catalog_url: string;
      },
      [string]
    >("SELECT * FROM catalog_books WHERE url=?")
    .get(book.url)!;
  const text = [
    row.title,
    "Éditeur : Pika Édition.",
    `Auteurs : ${(JSON.parse(row.authors_json) as string[]).join(", ") || "non indiqués dans la source collectée"}.`,
    row.isbn13 ? `ISBN-13 : ${row.isbn13}.` : "",
    row.published_on ? `Date de parution annoncée : ${row.published_on}.` : "",
    row.synopsis ? `Résumé : ${row.synopsis}` : "",
    `Source catalogue : ${row.source_catalog_url}`,
  ]
    .filter(Boolean)
    .join("\n");
  archive.ingest(book.url, row.title, text, "fr");
}

export function publisherStatus(archive: Archive) {
  initPublisher(archive);
  return {
    books: archive.db
      .query<{ n: number }, []>("SELECT count(*) n FROM catalog_books")
      .get()!.n,
    withSynopsis: archive.db
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM catalog_books WHERE synopsis IS NOT NULL",
      )
      .get()!.n,
    queue: archive.db
      .query(
        "SELECT kind,state,count(*) count FROM publisher_queue GROUP BY kind,state",
      )
      .all(),
  };
}

export async function collectPublisher(
  archive: Archive,
  options: {
    maxRequests?: number;
    fetcher?: Fetcher;
    saveRaw?: boolean;
    retryFailed?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const max = options.maxRequests ?? 25;
  if (!Number.isSafeInteger(max) || max < 1 || max > 1000)
    throw new Error("Budget Pika : entier de 1 à 1000");
  initPublisher(archive);
  const token = crypto.randomUUID();
  const now = () => Math.floor(Date.now() / 1000);
  archive.db.transaction(() => {
    const lock = archive.db
      .query<{ expires_at: number }, []>(
        "SELECT expires_at FROM publisher_lock WHERE id=1",
      )
      .get();
    if (lock && lock.expires_at > now())
      throw new Error("Une collecte Pika est déjà active");
    archive.db
      .query("INSERT OR REPLACE INTO publisher_lock VALUES(1,?,?)")
      .run(token, now() + 120);
    archive.db
      .query("UPDATE publisher_queue SET state='pending' WHERE state='running'")
      .run();
    if (options.retryFailed)
      archive.db
        .query(
          "UPDATE publisher_queue SET state='pending' WHERE state='failed'",
        )
        .run();
  })();
  let attempted = 0,
    completed = 0;
  const errors: { url: string; error: string }[] = [];
  const fetcher =
    options.fetcher ??
    (async (url: string) =>
      (await aphrodyWeb(["fetch", url, "--json"], 45000)) as FetchResult);
  try {
    while (attempted < max) {
      options.signal?.throwIfAborted();
      const job = archive.db
        .query<{ url: string; kind: string }, []>(
          "SELECT url,kind FROM publisher_queue WHERE state='pending' ORDER BY CASE kind WHEN 'listing' THEN 0 ELSE 1 END,url LIMIT 1",
        )
        .get();
      if (!job) break;
      archive.db
        .query(
          "UPDATE publisher_queue SET state='running',attempts=attempts+1 WHERE url=?",
        )
        .run(job.url);
      archive.db
        .query("UPDATE publisher_lock SET expires_at=? WHERE token=?")
        .run(now() + 120, token);
      attempted++;
      try {
        const page = await fetcher(job.url);
        if (
          page.transport.status !== 200 ||
          publisherUrl(page.transport.final_url) !== job.url ||
          page.truncated ||
          typeof page.body !== "string"
        )
          throw new Error(
            `Réponse Pika invalide ou tronquée (HTTP ${page.transport.status})`,
          );
        const hash = new Bun.CryptoHasher("sha256")
          .update(page.body)
          .digest("hex");
        if (options.saveRaw !== false) {
          mkdirSync("data/pika", { recursive: true });
          await Bun.write(
            resolve(
              "data/pika",
              `${new Bun.CryptoHasher("sha256").update(job.url).digest("hex")}.json`,
            ),
            JSON.stringify(page),
          );
        }
        archive.db.transaction(() => {
          if (job.kind === "listing") {
            const parsed = parsePublisherListing(page.body, job.url);
            if (!parsed.books.length)
              throw new Error(
                "Catalogue Pika sans cartes : arrêt de cette page",
              );
            for (const listing of parsed.listings)
              archive.db
                .query(
                  "INSERT OR IGNORE INTO publisher_queue(url,kind) VALUES(?,'listing')",
                )
                .run(listing);
            for (const book of parsed.books) {
              saveBook(archive, book, job.url);
              archive.db
                .query(
                  "INSERT OR IGNORE INTO publisher_queue(url,kind) VALUES(?,'book')",
                )
                .run(book.url);
            }
          } else
            saveBook(
              archive,
              parsePublisherBook(page.body, job.url),
              publisherSeed,
              true,
            );
          archive.db
            .query(
              "UPDATE publisher_queue SET state='done',last_error=NULL,content_hash=?,checked_at=CURRENT_TIMESTAMP WHERE url=?",
            )
            .run(hash, job.url);
        })();
        completed++;
      } catch (error) {
        const message = String(error);
        archive.db
          .query(
            "UPDATE publisher_queue SET state='failed',last_error=?,checked_at=CURRENT_TIMESTAMP WHERE url=?",
          )
          .run(message, job.url);
        errors.push({ url: job.url, error: message });
      }
      if (!options.fetcher && attempted < max) await Bun.sleep(1000);
    }
    return { attempted, completed, errors, ...publisherStatus(archive) };
  } finally {
    archive.db
      .query("UPDATE publisher_queue SET state='pending' WHERE state='running'")
      .run();
    archive.db.query("DELETE FROM publisher_lock WHERE token=?").run(token);
  }
}
