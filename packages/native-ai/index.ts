import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Archive, Hit } from "../archive/index.ts";
import { searchIndex } from "../search-index/index.ts";
import { shenronStatus } from "./shenron.ts";
import { koharuStatus } from "../scene/koharu.ts";

const inputLimit = 256 * 1024,
  outputLimit = 8 * 1024 * 1024;
const children = new Set<ReturnType<typeof Bun.spawn>>();
let activeCommands = 0;
let cancellationEpoch = 0;
const commandQueue: Array<() => void> = [];
async function acquireCommand() {
  if (activeCommands < 4) {
    activeCommands++;
    return;
  }
  if (commandQueue.length >= 32) throw new Error("Native command queue full");
  await new Promise<void>((resolve) => commandQueue.push(resolve));
}
function releaseCommand() {
  const next = commandQueue.shift();
  if (next) next();
  else activeCommands--;
}
export async function cancelNativeCalls() {
  cancellationEpoch++;
  const pending = [...children];
  for (const child of pending) child.kill();
  await Promise.allSettled(pending.map((child) => child.exited));
}
async function boundedText(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Sortie native trop volumineuse");
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
async function command(args: string[], body?: string): Promise<string> {
  const epoch = cancellationEpoch;
  await acquireCommand();
  try {
    if (epoch !== cancellationEpoch)
      throw new Error("Native command cancelled");
    return await runCommand(args, body);
  } finally {
    releaseCommand();
  }
}
async function runCommand(args: string[], body?: string): Promise<string> {
  const child = Bun.spawn(["aphrody", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(body === undefined
      ? {}
      : { stdin: new Blob([body], { type: "application/json" }) }),
  });
  children.add(child);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      boundedText(child.stdout, outputLimit),
      boundedText(child.stderr, 65536),
      child.exited,
    ]);
    if (timedOut) throw new Error("Délai du moteur natif dépassé (20 s)");
    if (code !== 0)
      throw new Error(`Aphrody natif (${code}): ${stderr.slice(0, 2000)}`);
    return stdout;
  } catch (e) {
    child.kill();
    await child.exited;
    throw e;
  } finally {
    children.delete(child);
    clearTimeout(timer);
  }
}

/** Delegate directly to aphrody-rag-core's versioned native JSON surface. */
export async function callRagCore<T = unknown>(
  op: string,
  input: unknown,
): Promise<T> {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(op))
    throw new Error("Nom d’opération RAG natif invalide");
  const body = JSON.stringify(input);
  if (
    body === undefined ||
    new TextEncoder().encode(body).byteLength > inputLimit
  )
    throw new Error("Entrée RAG JSON requise, maximum 256 Kio");
  return JSON.parse(await command(["pure", "rag", "call", op, "-"], body)) as T;
}

export async function nativeStatus() {
  const [rag, ai] = await Promise.allSettled([
    command(["pure", "rag", "ops"]),
    command(["ai", "status"]),
  ]);
  let ragStatus: Record<string, unknown>;
  if (rag.status === "fulfilled") {
    try {
      const manifest = JSON.parse(rag.value) as {
        abi: number;
        crate: string;
        json: { name: string; summary: string }[];
        vec: { name: string; summary: string }[];
        version: string;
      };
      if (
        manifest.abi !== 1 ||
        manifest.crate !== "aphrody-rag-core" ||
        !Array.isArray(manifest.json) ||
        !Array.isArray(manifest.vec)
      )
        throw new Error("Manifest RAG natif incompatible");
      ragStatus = { available: true, ...manifest };
    } catch (e) {
      ragStatus = { available: false, error: String(e) };
    }
  } else ragStatus = { available: false, error: String(rag.reason) };
  let aiStatus: Record<string, unknown>;
  if (ai.status === "fulfilled") {
    const features: Record<string, boolean | null> = {};
    for (const name of ["rag", "infer", "ocr", "train"]) {
      const value = new RegExp(`\\b${name}=(true|false)\\b`).exec(
        ai.value,
      )?.[1];
      features[name] = value === undefined ? null : value === "true";
    }
    aiStatus = {
      available: true,
      runtimeReadiness: "not_probed",
      features,
      models: [...ai.value.matchAll(/^\s*-\s+(.+)$/gm)].map(
        (match) => match[1]!,
      ),
      inventoryOnly: true,
    };
  } else
    aiStatus = {
      available: false,
      runtimeReadiness: "not_probed",
      error: String(ai.reason),
    };
  return {
    rag: ragStatus,
    ai: aiStatus,
    shenron: await shenronStatus(),
    koharu: await koharuStatus(),
    retrieval: {
      neuralEmbeddings: false,
      encoding: "lexical-hash-v1",
      ranking: "aphrody-rag-core",
    },
  };
}

export type SourceKind =
  "manga" | "author" | "official" | "wiki" | "captures" | "other";
export const sourceWeights: Record<SourceKind, number> = {
  manga: 1.4,
  author: 1.35,
  official: 1.2,
  wiki: 1,
  captures: 0.65,
  other: 0.8,
};
export function sourceKind(address: string): SourceKind {
  if (address.startsWith("local:manga/")) return "manga";
  if (address.startsWith("local:author/")) return "author";
  if (/^local:(?:frames?|episodes?|captures?)\//.test(address))
    return "captures";
  try {
    const url = new URL(address),
      host = url.hostname.toLowerCase();
    const is = (domain: string) =>
      host === domain || host.endsWith(`.${domain}`);
    if (["fandom.com", "wikia.com", "wikipedia.org"].some(is)) return "wiki";
    if (is("fancaps.net")) return "captures";
    if (
      (is("x.com") || is("twitter.com")) &&
      /^\/hiro_mashima(?:\/|$)/i.test(url.pathname)
    )
      return "author";
    if (
      [
        "pika.fr",
        "kodansha.us",
        "kodansha.co.jp",
        "fairytailgame.com",
        "gamecity.ne.jp",
        "tv-tokyo.co.jp",
        "fairytail100yq.com",
        "netflix.com",
      ].some(is)
    )
      return "official";
  } catch {
    /* Unclassified local identifiers remain ordinary sources. */
  }
  return "other";
}
type Ranked = { id: string | number; score: number };
function ranked(value: unknown): Ranked[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (row) =>
        row &&
        ["string", "number"].includes(typeof row.id) &&
        typeof row.score === "number" &&
        Number.isFinite(row.score),
    )
  )
    throw new Error("Résultat de classement natif invalide");
  return value as Ranked[];
}

export async function hybridSearch(
  archive: Archive,
  query: string,
  options: {
    lang?: string;
    limit?: number;
    indexPath?: string;
    manifestPath?: string;
  } = {},
) {
  if (!query.trim() || query.length > 2000)
    throw new Error("Question requise, maximum 2000 caractères");
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("limit: entier entre 1 et 50");
  const budget = Math.min(50, Math.max(10, limit * 3));
  const lexical = archive.search(query, budget, options.lang);
  let vector: Hit[] = [],
    vectorError: string | undefined;
  try {
    vector = await searchIndex(archive, query, {
      lang: options.lang,
      limit: budget,
      path: options.indexPath,
      manifestPath: options.manifestPath,
    });
  } catch (e) {
    vectorError = e instanceof Error ? e.message : String(e);
  }
  const mode =
    vectorError === undefined
      ? ("hybrid-lexical-hash" as const)
      : ("lexical" as const);
  const lookup = new Map(
    [...lexical, ...vector].map((hit) => [String(hit.id), hit]),
  );
  const lists = [
    { ids: lexical.map((hit) => String(hit.id)), weight: 1 },
    ...(vectorError === undefined
      ? [{ ids: vector.map((hit) => String(hit.id)), weight: 1 }]
      : []),
  ];
  const fused = ranked(await callRagCore("rrf_weighted", { lists, k: 60 }));
  const candidates = fused.map((item) => {
    const hit = lookup.get(String(item.id));
    if (!hit) throw new Error("Identifiant de classement natif inconnu");
    const kind = sourceKind(hit.url);
    return { id: String(item.id), score: item.score, source_id: kind, kind };
  });
  const weighted = ranked(
    await callRagCore("apply_source_weights", {
      candidates,
      weights: Object.entries(sourceWeights).map(([source_id, weight]) => ({
        source_id,
        weight,
      })),
      protected_kinds: ["manga", "author"],
      top_n: limit,
    }),
  );
  const hits = weighted.map((item) => {
    const hit = lookup.get(String(item.id));
    if (!hit) throw new Error("Identifiant de pondération natif inconnu");
    const kind = sourceKind(hit.url);
    // Native weighting orders candidates but retains their original RRF scores.
    return {
      ...hit,
      score: item.score,
      sourceKind: kind,
      sourceWeight: sourceWeights[kind],
    };
  });
  return {
    mode,
    vectorError,
    hits,
    ranking: "aphrody-rag-core",
    neuralEmbeddings: false,
  };
}

/** Stream a neutral, explicitly addressed corpus for Shenron's existing Rust ingester. */
export async function exportCorpus(archive: Archive, address: string) {
  const path = resolve(address);
  if (!path.toLowerCase().endsWith(".jsonl"))
    throw new Error("Le corpus exporté doit utiliser une extension .jsonl");
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.building-${crypto.randomUUID()}`;
  const marker = () => ({
    version: archive.db
      .query<{ data_version: number }, []>("PRAGMA data_version")
      .get()!.data_version,
    changes: archive.db
      .query<{ n: number }, []>("SELECT total_changes() n")
      .get()!.n,
  });
  const before = JSON.stringify(marker());
  let after = 0,
    documents = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const rows = archive.db
          .query<
            {
              id: number;
              title: string;
              url: string;
              text: string;
              language: string;
            },
            [number]
          >(
            "SELECT id,title,url,text,language FROM documents WHERE id>? ORDER BY id LIMIT 16",
          )
          .all(after);
        if (!rows.length) {
          controller.close();
          return;
        }
        for (const row of rows) {
          const doc = {
            id: `fairytail:document:${row.id}`,
            name: row.title,
            url: row.url,
            markdown: row.text,
            lang: row.language,
            kind: sourceKind(row.url),
          };
          controller.enqueue(encoder.encode(JSON.stringify(doc) + "\n"));
          after = row.id;
          documents++;
        }
      } catch (e) {
        controller.error(e);
      }
    },
  });
  try {
    await Bun.write(temporary, new Response(stream));
    if (JSON.stringify(marker()) !== before)
      throw new Error(
        "Archive modifiée pendant l’export : relancer sur un corpus stable",
      );
    renameSync(temporary, path);
    return { path, documents, format: "ShenronCorpusDoc-jsonl" as const };
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* The owned temporary file may already be published. */
    }
  }
}
