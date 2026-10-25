import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  cjkGrams,
  searchTerms,
  type Archive,
  type Hit,
} from "../archive/index.ts";

const dimensions = 256;
const encoding = "lexical-hash-v1";
const hashSignature = [Bun.hash("fairy-tail-index-v1"), Bun.hash("ナツ")]
  .map((value) => value.toString(16))
  .join(":");
type Paths = { path?: string; manifestPath?: string };
type Chunk = {
  id: number;
  text: string;
  title: string;
  url: string;
  language: string;
};
type Revision = { archive_id: string; revision: number };
export type IndexManifest = {
  version: 1;
  encoding: string;
  hashSignature: string;
  dimensions: number;
  metric: "cosine";
  archiveId: string;
  revision: number;
  corpusDigest: string;
  indexDigest: string;
  chunks: number;
  entries: number;
  createdAt: string;
};

function paths(options: Paths) {
  const path = resolve(options.path ?? "data/search.index");
  const manifest = resolve(options.manifestPath ?? `${path}.json`);
  if (path === manifest)
    throw new Error("Le fichier index et son manifest doivent être distincts");
  return { path, manifest };
}
function provider() {
  if (typeof Bun.VectorIndex !== "function" || !Bun.VectorIndex.available)
    throw new Error("Fournisseur natif Bun.VectorIndex indisponible");
}
function state(archive: Archive): Revision | null {
  if (
    !archive.db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_index_state'",
      )
      .get()
  )
    return null;
  return archive.db
    .query<Revision, []>(
      "SELECT archive_id,revision FROM search_index_state WHERE id=1",
    )
    .get();
}
function tracking(archive: Archive) {
  archive.db.run(
    "CREATE TABLE IF NOT EXISTS search_index_state(id INTEGER PRIMARY KEY CHECK(id=1),archive_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)",
  );
  archive.db
    .query(
      "INSERT OR IGNORE INTO search_index_state(id,archive_id) VALUES(1,?)",
    )
    .run(crypto.randomUUID());
  for (const table of ["documents", "chunks"])
    for (const event of ["INSERT", "UPDATE", "DELETE"])
      archive.db.run(
        `CREATE TRIGGER IF NOT EXISTS search_index_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN UPDATE search_index_state SET revision=revision+1 WHERE id=1; END`,
      );
}

/** Feature hashing of lexical words and CJK bigrams, without a model or semantic embeddings. */
export function lexicalVector(input: string): Float32Array {
  const text = searchTerms(input),
    terms = new Map<string, number>();
  const add = (term: string) => terms.set(term, (terms.get(term) ?? 0) + 1);
  for (const match of text.matchAll(
    /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]+/gu,
  ))
    add(`w:${match[0]}`);
  for (const gram of cjkGrams(text)) add(`j:${gram}`);
  const result = new Float32Array(dimensions);
  for (const [term, count] of terms) {
    const hash = Bun.hash(term),
      slot = Number(hash & 255n),
      sign = (hash & 256n) === 0n ? 1 : -1;
    result[slot]! += sign * (1 + Math.log(count));
  }
  let length = 0;
  for (const value of result) length += value * value;
  if (length > 0)
    for (let i = 0; i < result.length; i++) result[i]! /= Math.sqrt(length);
  return result;
}
function key(id: number): bigint {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identifiant de chunk hors de la plage entière sûre");
  return BigInt(id);
}
async function fileDigest(path: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const bytes of Bun.file(path).stream()) hash.update(bytes);
  return hash.digest("hex");
}
function cleanup(path: string) {
  try {
    unlinkSync(path);
  } catch {
    /* Only an owned temporary file is removed. */
  }
}

/** Explicit build. Corpus reads use bounded SQLite batches in one snapshot. */
export async function buildIndex(archive: Archive, options: Paths = {}) {
  provider();
  const target = paths(options),
    suffix = `.building-${crypto.randomUUID()}`;
  const temporary = target.path + suffix,
    temporaryManifest = target.manifest + suffix;
  mkdirSync(dirname(target.path), { recursive: true });
  mkdirSync(dirname(target.manifest), { recursive: true });
  tracking(archive);
  const index = new Bun.VectorIndex(temporary, {
    dimensions,
    metric: "cosine",
  });
  try {
    const snapshot = archive.db.transaction(() => {
      const revision = state(archive)!;
      const hash = new Bun.CryptoHasher("sha256");
      let after = 0,
        chunks = 0,
        entries = 0;
      while (true) {
        const rows = archive.db
          .query<Chunk, [number]>(
            `SELECT c.id,c.text,d.title,d.url,d.language FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id>? ORDER BY c.id LIMIT 256`,
          )
          .all(after);
        if (!rows.length) break;
        for (const row of rows) {
          hash.update(JSON.stringify(row) + "\n");
          const id = key(row.id),
            vector = lexicalVector(row.text);
          if (vector.some((value) => value !== 0)) {
            index.add(id, vector);
            entries++;
          }
          after = row.id;
          chunks++;
        }
      }
      return { revision, corpusDigest: hash.digest("hex"), chunks, entries };
    })();
    index.save();
    index.close();
    const manifest: IndexManifest = {
      version: 1,
      encoding,
      hashSignature,
      dimensions,
      metric: "cosine",
      archiveId: snapshot.revision.archive_id,
      revision: snapshot.revision.revision,
      corpusDigest: snapshot.corpusDigest,
      indexDigest: await fileDigest(temporary),
      chunks: snapshot.chunks,
      entries: snapshot.entries,
      createdAt: new Date().toISOString(),
    };
    // If imports occurred after the snapshot, do not publish an already stale generation.
    const current = state(archive);
    if (
      current?.archive_id !== manifest.archiveId ||
      current.revision !== manifest.revision
    )
      throw new Error("Le corpus a changé pendant la construction de l’index");
    await Bun.write(temporaryManifest, JSON.stringify(manifest, null, 2));
    // Native save is atomic; the digest makes a partial two-file publication detectable.
    renameSync(temporary, target.path);
    renameSync(temporaryManifest, target.manifest);
    return { path: target.path, manifestPath: target.manifest, ...manifest };
  } finally {
    index.close();
    cleanup(temporary);
    cleanup(temporaryManifest);
  }
}

async function manifestFor(
  archive: Archive,
  options: Paths,
): Promise<{ target: ReturnType<typeof paths>; manifest: IndexManifest }> {
  provider();
  const target = paths(options);
  let manifest: IndexManifest;
  try {
    manifest = (await Bun.file(target.manifest).json()) as IndexManifest;
  } catch {
    throw new Error("Index absent : exécuter bun index avant la recherche");
  }
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.encoding !== encoding ||
    manifest.hashSignature !== hashSignature ||
    manifest.dimensions !== dimensions ||
    manifest.metric !== "cosine" ||
    !Number.isSafeInteger(manifest.entries) ||
    manifest.entries < 0 ||
    !Number.isSafeInteger(manifest.chunks) ||
    manifest.chunks < manifest.entries ||
    typeof manifest.corpusDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.corpusDigest)
  )
    throw new Error("Manifest d’index incompatible");
  const current = state(archive);
  if (
    !current ||
    current.archive_id !== manifest.archiveId ||
    current.revision !== manifest.revision
  )
    throw new Error("Index périmé : le corpus a changé, exécuter bun index");
  let digest: string;
  try {
    digest = await fileDigest(target.path);
  } catch {
    throw new Error("Fichier index absent : exécuter bun index");
  }
  if (digest !== manifest.indexDigest)
    throw new Error("Index et manifest incohérents : exécuter bun index");
  const after = state(archive);
  if (
    after?.archive_id !== manifest.archiveId ||
    after.revision !== manifest.revision
  )
    throw new Error(
      "Index périmé : le corpus a changé pendant la vérification",
    );
  return { target, manifest };
}

export async function indexStatus(archive: Archive, options: Paths = {}) {
  try {
    const { target, manifest } = await manifestFor(archive, options);
    return {
      ready: true,
      path: target.path,
      manifestPath: target.manifest,
      ...manifest,
    };
  } catch (e) {
    return {
      ready: false,
      path: paths(options).path,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function searchIndex(
  archive: Archive,
  query: string,
  options: Paths & { limit?: number; lang?: string } = {},
): Promise<Hit[]> {
  if (!query.trim() || query.length > 2000)
    throw new Error("Recherche requise, maximum 2000 caractères");
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("limit: entier entre 1 et 50");
  const { target, manifest } = await manifestFor(archive, options);
  const vector = lexicalVector(query);
  if (!vector.some((value) => value !== 0)) return [];
  const allowedKeys =
    options.lang === undefined
      ? undefined
      : archive.db
          .query<{ id: number }, [string]>(
            "SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.language=?",
          )
          .all(options.lang)
          .map((row) => key(row.id));
  const index = new Bun.VectorIndex(target.path, {
    dimensions,
    metric: "cosine",
  });
  try {
    if (index.count !== manifest.entries)
      throw new Error("Nombre d’entrées incohérent : exécuter bun index");
    const hits = index.search(
      vector,
      limit,
      allowedKeys === undefined ? {} : { allowedKeys },
    );
    const result: Hit[] = [];
    for (const hit of hits) {
      if (hit.score <= 0) continue;
      const row = archive.db
        .query<Omit<Hit, "score">, [bigint]>(
          "SELECT c.id,d.title,d.url,c.text,d.language FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?",
        )
        .get(hit.key);
      if (!row)
        throw new Error("Chunk manquant dans SQLite : exécuter bun index");
      result.push({ ...row, score: hit.score });
    }
    return result;
  } finally {
    index.close();
  }
}
