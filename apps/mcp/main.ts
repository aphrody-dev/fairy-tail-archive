import { Archive } from "../../packages/archive/index.ts";
import { resolve } from "node:path";
import { ask } from "../../packages/rag/index.ts";
import { hybridSearch, nativeStatus } from "../../packages/native-ai/index.ts";
import {
  libraryOverview,
  listMangaVolumes,
  readMangaPreview,
  animeCatalog,
  wikiDocuments,
  getWikiDocument,
} from "../../packages/library/index.ts";

import {
  listAnimeWorks,
  getAnimeWork,
  animeCatalogStatus,
} from "../../packages/anime-catalog/index.ts";
import { listAnimeArcs } from "../../packages/anime-catalog/arcs.ts";

type JsonObject = Record<string, unknown>;
type RpcId = string | number | null;
export type McpResponse = {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string };
};
type Property = {
  type: "string" | "integer";
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  pattern?: string;
  default?: unknown;
};
type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Property>;
    required?: string[];
    additionalProperties: false;
  };
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
};
const language: Property = {
  type: "string",
  enum: ["fr", "en", "ja", "und"],
  description:
    "Langue optionnelle ; ask détecte prudemment les mots de question si absente.",
};
const query: Property = { type: "string", minLength: 1, maxLength: 2000 };
const limit: Property = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  default: 20,
};
const offset: Property = {
  type: "integer",
  minimum: 0,
  maximum: 1000000,
  default: 0,
};
const tool = (
  name: string,
  description: string,
  properties: Record<string, Property> = {},
  required: string[] = [],
): Tool => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});
export const mcpTools: Tool[] = [
  tool(
    "fairy_tail_search",
    "Recherche hybride native avec passages et URLs sources ; le mode de récupération réel est retourné.",
    { query, lang: language, limit: { ...limit, maximum: 50, default: 10 } },
    ["query"],
  ),
  tool(
    "fairy_tail_ask",
    "Réponse extractive sourcée depuis le corpus local ; aucun LLM ou téléchargement implicite.",
    { question: query, lang: language },
    ["question"],
  ),
  tool(
    "fairy_tail_context",
    "Lire un chunk local et sa provenance ; texte borné à 16000 caractères.",
    { chunk_id: { type: "integer", minimum: 1 } },
    ["chunk_id"],
  ),
  tool(
    "fairy_tail_coverage",
    "Couverture locale par langue et état des files déjà présentes.",
  ),
  tool(
    "fairy_tail_books",
    "Catalogue Pika local paginé, sans collecte réseau.",
    { limit, offset },
  ),
  tool(
    "fairy_tail_media",
    "Catalogue public Netflix/YouTube déjà indexé et liens vers les épisodes locaux.",
    {
      provider: { type: "string", enum: ["netflix", "youtube"] },
      limit,
      offset,
    },
  ),
  tool(
    "fairy_tail_fancaps",
    "Catalogue local Fancaps et miniatures déjà en cache ; aucune requête distante.",
    {
      episode_id: { type: "integer", minimum: 1 },
      limit: { ...limit, maximum: 200, default: 50 },
      offset,
    },
  ),
  tool(
    "fairy_tail_native_status",
    "État déclaré et qualifié des propriétaires IA, RAG et récupération natifs.",
  ),
  tool(
    "fairy_tail_library",
    "Bibliothèque locale manga/anime/wiki. Distingue catalogue, extraits publics, fichiers anime locaux et documents sourcés ; aucune récupération ni extraction implicite.",
    {
      kind: {
        type: "string",
        enum: [
          "overview",
          "manga",
          "anime",
          "wiki",
          "anime_works",
          "anime_work",
          "anime_arcs",
          "anime_catalog_status",
        ],
        default: "overview",
      },
      q: { type: "string", minLength: 1, maxLength: 256 },
      lang: language,
      limit,
      offset,
      isbn: { type: "string", pattern: "^[0-9]{13}$" },
      document_id: { type: "integer", minimum: 1 },
      work_id: {
        type: "string",
        pattern: "^[a-f0-9]{24}$",
        description:
          "Identifiant du catalogue anime local ; requis pour anime_work.",
      },
    },
  ),
];
const versions = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const sessions = new WeakMap<Archive, { version: string }>();
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
const rpcError = (id: RpcId, code: number, message: string): McpResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function params(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!object(value)) throw new RpcError(-32602, "params must be an object");
  return value;
}
function validate(definition: Tool, value: unknown): JsonObject {
  const args = params(value);
  for (const key of Object.keys(args))
    if (!Object.hasOwn(definition.inputSchema.properties, key))
      throw new RpcError(-32602, `Unknown argument: ${key}`);
  for (const key of definition.inputSchema.required ?? [])
    if (!Object.hasOwn(args, key))
      throw new RpcError(-32602, `Missing argument: ${key}`);
  const result: JsonObject = Object.create(null);
  for (const [key, property] of Object.entries(
    definition.inputSchema.properties,
  )) {
    const value = Object.hasOwn(args, key) ? args[key] : property.default;
    if (value === undefined) continue;
    if (property.type === "string") {
      if (
        typeof value !== "string" ||
        (property.minLength !== undefined &&
          value.trim().length < property.minLength) ||
        (property.maxLength !== undefined &&
          value.length > property.maxLength) ||
        (property.enum && !property.enum.includes(value)) ||
        (property.pattern && !new RegExp(property.pattern).test(value))
      )
        throw new RpcError(-32602, `Invalid argument: ${key}`);
    } else if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      (property.minimum !== undefined && value < property.minimum) ||
      (property.maximum !== undefined && value > property.maximum)
    )
      throw new RpcError(-32602, `Invalid argument: ${key}`);
    result[key] = value;
  }
  return result;
}
const table = (archive: Archive, name: string) =>
  !!archive.db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(name);
const count = (archive: Archive, name: string) =>
  table(archive, name)
    ? archive.db
        .query<{ n: number }, []>(`SELECT count(*) n FROM ${name}`)
        .get()!.n
    : 0;
function coverage(archive: Archive) {
  const queues: Record<string, unknown> = Object.create(null);
  for (const name of ["publisher_queue", "wiki_jobs", "fancaps_pages"])
    if (table(archive, name))
      queues[name] = archive.db
        .query(
          `SELECT state,count(*) n FROM ${name} GROUP BY state ORDER BY state`,
        )
        .all();
  return {
    stats: archive.stats(),
    languages: archive.db
      .query(
        "SELECT language,count(*) documents FROM documents GROUP BY language ORDER BY language",
      )
      .all(),
    queues,
    books: count(archive, "catalog_books"),
    media: count(archive, "media_catalog"),
    fancapsImages: count(archive, "fancaps_images"),
    cachedFancapsImages: table(archive, "fancaps_images")
      ? archive.db
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM fancaps_images WHERE cache_state='cached'",
          )
          .get()!.n
      : 0,
  };
}
async function execute(
  archive: Archive,
  name: string,
  args: JsonObject,
): Promise<unknown> {
  switch (name) {
    case "fairy_tail_library": {
      const kind = args.kind as string;
      if (args.isbn !== undefined && kind !== "manga")
        throw new RpcError(-32602, "isbn applies only to kind manga");
      if (args.document_id !== undefined && kind !== "wiki")
        throw new RpcError(-32602, "document_id applies only to kind wiki");
      const animeAction = [
        "anime_works",
        "anime_work",
        "anime_arcs",
        "anime_catalog_status",
      ].includes(kind);
      if (args.work_id !== undefined && kind !== "anime_work")
        throw new RpcError(-32602, "work_id applies only to kind anime_work");
      if (kind === "anime_work" && args.work_id === undefined)
        throw new RpcError(-32602, "work_id is required for kind anime_work");
      if (animeAction && args.q !== undefined)
        throw new RpcError(
          -32602,
          "q is unsupported for anime catalogue actions",
        );
      if (animeAction && args.lang !== undefined && kind !== "anime_arcs")
        throw new RpcError(
          -32602,
          "lang applies only to anime_arcs among anime catalogue actions",
        );
      if (kind === "anime_arcs" && args.lang === "und")
        throw new RpcError(-32602, "anime_arcs lang must be fr, en or ja");
      if (kind === "anime_arcs" && (args.offset as number) > 100000)
        throw new RpcError(-32602, "anime_arcs offset must be at most 100000");
      const options = {
        limit: args.limit as number,
        offset: args.offset as number,
        q: args.q as string | undefined,
      };
      if (kind === "anime_works")
        return {
          items: listAnimeWorks(archive, options),
          limit: options.limit,
          offset: options.offset,
        };
      if (kind === "anime_work") {
        const work = getAnimeWork(archive, args.work_id as string, options);
        if (!work) throw new Error("Œuvre anime introuvable");
        return { ...work, limit: options.limit, offset: options.offset };
      }
      if (kind === "anime_arcs")
        return {
          items: listAnimeArcs(archive, {
            ...options,
            lang: args.lang as string | undefined,
          }),
          limit: options.limit,
          offset: options.offset,
        };
      if (kind === "anime_catalog_status") return animeCatalogStatus(archive);
      if (kind === "overview") return libraryOverview(archive);
      if (kind === "manga")
        return args.isbn
          ? readMangaPreview(archive, args.isbn as string, options)
          : listMangaVolumes(archive, options);
      if (kind === "anime") return await animeCatalog(archive, options);
      if (args.document_id !== undefined) {
        const document = getWikiDocument(archive, args.document_id as number);
        if (!document) throw new Error("Document wiki introuvable");
        return document;
      }
      return wikiDocuments(archive, {
        ...options,
        lang: args.lang as string | undefined,
      });
    }
    case "fairy_tail_search":
      return await hybridSearch(archive, args.query as string, {
        lang: args.lang as string | undefined,
        limit: args.limit as number,
      });
    case "fairy_tail_ask":
      return await ask(
        archive,
        args.question as string,
        args.lang as string | undefined,
      );
    case "fairy_tail_context": {
      const row = archive.db
        .query<
          {
            id: number;
            title: string;
            url: string;
            language: string;
            text: string;
          },
          [number]
        >(
          "SELECT c.id,d.title,d.url,d.language,c.text FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?",
        )
        .get(args.chunk_id as number);
      if (!row) throw new Error("Chunk introuvable");
      return {
        ...row,
        text: row.text.slice(0, 16000),
        truncated: row.text.length > 16000,
      };
    }
    case "fairy_tail_coverage":
      return coverage(archive);
    case "fairy_tail_books":
      return {
        total: count(archive, "catalog_books"),
        offset: args.offset,
        limit: args.limit,
        items: table(archive, "catalog_books")
          ? archive.db
              .query(
                "SELECT * FROM catalog_books ORDER BY url LIMIT ? OFFSET ?",
              )
              .all(args.limit as number, args.offset as number)
          : [],
      };
    case "fairy_tail_media": {
      const provider = (args.provider as string) ?? null;
      const has = table(archive, "media_catalog");
      return {
        sources: table(archive, "media_sources")
          ? archive.db
              .query(
                "SELECT provider,source_id,url,title,description,language,advertised_seasons,continuation IS NOT NULL AS pending_continuation,fetched_at FROM media_sources WHERE (? IS NULL OR provider=?) ORDER BY provider,source_id",
              )
              .all(provider, provider)
          : [],
        items: has
          ? archive.db
              .query(
                `SELECT c.*,${table(archive, "media_local_links") ? "l.episode_id" : "NULL AS episode_id"} FROM media_catalog c ${table(archive, "media_local_links") ? "LEFT JOIN media_local_links l ON l.provider=c.provider AND l.item_key=c.item_key" : ""} WHERE (? IS NULL OR c.provider=?) ORDER BY c.provider,c.item_key LIMIT ? OFFSET ?`,
              )
              .all(
                provider,
                provider,
                args.limit as number,
                args.offset as number,
              )
          : [],
        total: has
          ? archive.db
              .query<{ n: number }, [string | null, string | null]>(
                "SELECT count(*) n FROM media_catalog WHERE (? IS NULL OR provider=?)",
              )
              .get(provider, provider)!.n
          : 0,
        limit: args.limit,
        offset: args.offset,
      };
    }
    case "fairy_tail_fancaps": {
      const episode = (args.episode_id as number) ?? null;
      const images = table(archive, "fancaps_images")
        ? archive.db
            .query(
              "SELECT id,episode_id,picture_url,thumbnail_url,full_url,variant,cdn_origin,source_page,cache_state,sha256,mime,bytes,width,height FROM fancaps_images WHERE (? IS NULL OR episode_id=?) ORDER BY episode_id,id LIMIT ? OFFSET ?",
            )
            .all(episode, episode, args.limit as number, args.offset as number)
            .map((image) => ({
              ...image,
              local_url:
                image.cache_state === "cached"
                  ? `/cdn/fancaps/${image.id}`
                  : null,
            }))
        : [];
      return {
        counts: {
          episodes: count(archive, "fancaps_episodes"),
          images: count(archive, "fancaps_images"),
          cachedImages: table(archive, "fancaps_images")
            ? archive.db
                .query<{ n: number }, []>(
                  "SELECT count(*) n FROM fancaps_images WHERE cache_state='cached'",
                )
                .get()!.n
            : 0,
        },
        episodes: table(archive, "fancaps_episodes")
          ? archive.db
              .query(
                "SELECT * FROM fancaps_episodes WHERE (? IS NULL OR id=?) ORDER BY number LIMIT ? OFFSET ?",
              )
              .all(
                episode,
                episode,
                args.limit as number,
                args.offset as number,
              )
          : [],
        images,
        limit: args.limit,
        offset: args.offset,
      };
    }
    case "fairy_tail_native_status":
      return await nativeStatus();
    default:
      throw new RpcError(-32602, "Unknown tool");
  }
}

export async function handleMcp(
  archive: Archive,
  message: unknown,
): Promise<McpResponse | undefined> {
  if (
    !object(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    (Object.hasOwn(message, "id") &&
      !(
        message.id === null ||
        typeof message.id === "string" ||
        (typeof message.id === "number" && Number.isFinite(message.id))
      ))
  )
    return rpcError(null, -32600, "Invalid Request");
  const notification = !Object.hasOwn(message, "id");
  if (notification) return undefined;
  const id = message.id as RpcId;
  try {
    const input = params(message.params);
    let result: unknown;
    if (message.method === "initialize") {
      if (
        typeof input.protocolVersion !== "string" ||
        !object(input.capabilities) ||
        !object(input.clientInfo) ||
        typeof input.clientInfo.name !== "string" ||
        typeof input.clientInfo.version !== "string"
      )
        throw new RpcError(
          -32602,
          "initialize requires protocolVersion, capabilities and clientInfo",
        );
      const version = versions.has(input.protocolVersion)
        ? input.protocolVersion
        : "2025-06-18";
      sessions.set(archive, { version });
      result = {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fairy-tail-archive", version: "0.1.0" },
        instructions:
          "Read-only local Fairy Tail corpus. Use search for passages, context for exact source chunks, and coverage before assuming completeness. No tool crawls, downloads episodes or fills a media cache.",
      };
    } else if (message.method === "ping") result = {};
    else {
      const session = sessions.get(archive);
      if (!session) throw new RpcError(-32002, "Server not initialized");
      if (message.method === "tools/list") {
        if (Object.hasOwn(input, "cursor"))
          throw new RpcError(
            -32602,
            "Tool list has one page; cursors are unsupported",
          );
        result = {
          tools: mcpTools.map((definition) =>
            session.version === "2024-11-05"
              ? {
                  name: definition.name,
                  description: definition.description,
                  inputSchema: definition.inputSchema,
                }
              : definition,
          ),
        };
      } else if (message.method === "tools/call") {
        if (typeof input.name !== "string")
          throw new RpcError(-32602, "Tool name is required");
        const definition = mcpTools.find(
          (definition) => definition.name === input.name,
        );
        if (!definition) throw new RpcError(-32602, "Unknown tool");
        const args = validate(definition, input.arguments);
        try {
          const value = await execute(archive, definition.name, args);
          result = {
            content: [{ type: "text", text: JSON.stringify(value) }],
            ...(session.version === "2025-06-18" && object(value)
              ? { structuredContent: value }
              : {}),
            isError: false,
          };
        } catch (error) {
          if (error instanceof RpcError) throw error;
          result = {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Tool execution failed",
              },
            ],
            isError: true,
          };
        }
      } else throw new RpcError(-32601, "Method not found");
    }
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    return error instanceof RpcError
      ? rpcError(id, error.code, error.message)
      : rpcError(id, -32603, "Internal error");
  }
}

/** Newline-delimited UTF-8 stdio. A logical line may arrive in any number of chunks. */
export async function serveMcp(
  archive: Archive,
  input: ReadableStream<Uint8Array>,
  write: (line: string) => Promise<unknown>,
) {
  const maximum = 1024 * 1024;
  let parts: Uint8Array[] = [],
    size = 0,
    discard = false;
  const emit = async (response: McpResponse | undefined) => {
    if (response) await write(JSON.stringify(response) + "\n");
  };
  const line = async () => {
    if (discard) {
      discard = false;
      parts = [];
      size = 0;
      return;
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const part of parts) {
      bytes.set(part, position);
      position += part.length;
    }
    parts = [];
    size = 0;
    let message: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .trim();
      if (!text) return;
      message = JSON.parse(text);
    } catch {
      await emit(rpcError(null, -32700, "Parse error"));
      return;
    }
    await emit(await handleMcp(archive, message));
  };
  try {
    for await (const chunk of input) {
      let start = 0;
      for (let i = 0; i <= chunk.length; i++)
        if (i === chunk.length || chunk[i] === 10) {
          if (i > start && !discard) {
            const part = chunk.slice(start, i);
            size += part.length;
            if (size > maximum) {
              discard = true;
              parts = [];
              size = 0;
              await emit(rpcError(null, -32600, "Message exceeds 1 MiB"));
            } else parts.push(part);
          }
          if (i < chunk.length) await line();
          start = i + 1;
        }
    }
    if (size || discard) await line();
  } finally {
    archive.close();
  }
}
if (import.meta.main) {
  process.chdir(resolve(import.meta.dir, "../.."));
  const archive = new Archive();
  try {
    await serveMcp(archive, Bun.stdin.stream(), (line) =>
      Bun.write(Bun.stdout, line),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "MCP stdio error");
    process.exitCode = 1;
  }
}
