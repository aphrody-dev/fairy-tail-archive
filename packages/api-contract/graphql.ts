import type { Archive } from "../archive/index.ts";
import {
  buildSchema,
  parse,
  validate,
  validateExecutionArgs,
  execute,
  GraphQLError,
  getArgumentValues,
  getNamedType,
  isCompositeType,
  isObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isEnumType,
  isInputObjectType,
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef,
  type SelectionSetNode,
  type GraphQLCompositeType,
  type ValidatedExecutionArgs,
} from "graphql";
export const schemaSDL = `
type Query {
  stats: Stats!
  search(q: String!, limit: Int = 10, lang: String): [SearchHit!]!
  episodes(limit: Int = 100, offset: Int = 0): [Episode!]!
  media(provider: String, limit: Int = 100, offset: Int = 0): [Media!]!
  books(limit: Int = 100, offset: Int = 0): [Book!]!
}
type Stats { documents: Int! chunks: Int! episodes: Int! frames: Int! }
type SearchHit { id: Int! title: String! url: String! text: String! score: Float! language: String }
type Episode { id: ID! metadata: String! nextFrame: Int! status: String! }
type Media { provider: String! sourceId: String! itemKey: String! providerId: String title: String! url: String! episode: Int season: Int durationSeconds: Int summary: String! audioLanguages: [String!]! subtitleLanguages: [String!]! episodeId: ID }
type Book { url: String! title: String! authors: [String!]! isbn13: String publishedOn: String synopsis: String sourceCatalogUrl: String! fetchedAt: String! detailsFetchedAt: String }
`;

const schema = buildSchema(schemaSDL);
const types = Object.values(schema.getTypeMap());
const maxFields = Math.max(
  1,
  ...types.map((t) =>
    isObjectType(t) || isInterfaceType(t)
      ? Object.keys(t.getFields()).length
      : 0,
  ),
);
const maxArgs = Math.max(
  1,
  ...types.flatMap((t) =>
    isObjectType(t) || isInterfaceType(t)
      ? Object.values(t.getFields()).map((f) => f.args.length)
      : [],
  ),
  ...schema.getDirectives().map((d) => d.args.length),
);
const maxEnumValues = Math.max(
  1,
  ...types.map((t) => (isEnumType(t) ? t.getValues().length : 0)),
);
const maxInputFields = Math.max(
  1,
  ...types.map((t) =>
    isInputObjectType(t) ? Object.keys(t.getFields()).length : 0,
  ),
);

export const graphQLLimits = Object.freeze({
  bodyBytes: 131072,
  sourceBytes: 32768,
  tokens: 8192,
  depth: 24,
  fieldCost: 250000,
});
function fail(message: string): never {
  throw new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}
function present(archive: Archive, table: string) {
  return !!archive.db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(table);
}
function page(args: Record<string, unknown>) {
  const limit = args.limit ?? 100,
    offset = args.offset ?? 0;
  if (
    typeof limit !== "number" ||
    limit < 1 ||
    limit > 100 ||
    typeof offset !== "number" ||
    offset < 0 ||
    offset > 100000
  )
    fail("Pagination requires limit 1..100 and offset 0..100000");
  return { limit, offset };
}
function jsonArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function resolveRoot(
  archive: Archive,
  selected: { name: string; args: Record<string, unknown> },
): unknown {
  const args = selected.args;
  if (selected.name === "__typename") return "Query";
  if (selected.name === "stats") return archive.stats();
  if (selected.name === "search") {
    if (typeof args.q !== "string" || !args.q.trim() || args.q.length > 2000)
      fail("Search q must have 1..2000 characters");
    const limit = args.limit ?? 10;
    if (typeof limit !== "number" || limit < 1 || limit > 50)
      fail("Search limit must be 1..50");
    if (
      args.lang !== undefined &&
      args.lang !== null &&
      !["fr", "en", "ja", "und"].includes(String(args.lang))
    )
      fail("Unsupported language");
    return archive.search(args.q, limit, args.lang as string | undefined);
  }
  const { limit, offset } = page(args);
  if (selected.name === "episodes")
    return archive.db
      .query(
        "SELECT id,metadata,next_frame AS nextFrame,status FROM episodes ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(limit, offset);
  if (selected.name === "books") {
    if (!present(archive, "catalog_books")) return [];
    return archive.db
      .query("SELECT * FROM catalog_books ORDER BY url LIMIT ? OFFSET ?")
      .all(limit, offset)
      .map((row) => ({
        url: row.url,
        title: row.title,
        authors: jsonArray(row.authors_json),
        isbn13: row.isbn13,
        publishedOn: row.published_on,
        synopsis: row.synopsis,
        sourceCatalogUrl: row.source_catalog_url,
        fetchedAt: row.fetched_at,
        detailsFetchedAt: row.details_fetched_at,
      }));
  }
  if (selected.name === "media") {
    if (
      args.provider !== undefined &&
      args.provider !== null &&
      !["netflix", "youtube"].includes(String(args.provider))
    )
      fail("Unsupported media provider");
    if (!present(archive, "media_catalog")) return [];
    return archive.db
      .query(
        "SELECT * FROM media_catalog WHERE (? IS NULL OR provider=?) ORDER BY provider,item_key LIMIT ? OFFSET ?",
      )
      .all(
        (args.provider as string) ?? null,
        (args.provider as string) ?? null,
        limit,
        offset,
      )
      .map((row) => ({
        provider: row.provider,
        sourceId: row.source_id,
        itemKey: row.item_key,
        providerId: row.provider_id,
        title: row.title,
        url: row.url,
        episode: row.episode_number,
        season: row.season_number,
        durationSeconds: row.duration_seconds,
        summary: row.summary,
        audioLanguages: jsonArray(row.audio_languages),
        subtitleLanguages: jsonArray(row.subtitle_languages),
        episodeId: present(archive, "media_local_links")
          ? (archive.db
              .query<{ episode_id: string }, [string, string]>(
                "SELECT episode_id FROM media_local_links WHERE provider=? AND item_key=?",
              )
              .get(String(row.provider), String(row.item_key))?.episode_id ??
            null)
          : null,
      }));
  }
  return fail(`Unknown resolver ${selected.name}`);
}

async function requestBody(request: Request): Promise<unknown> {
  if (!request.body) fail("JSON request body is required");
  const reader = request.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        fail("Request body exceeds 128 KiB");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof GraphQLError) throw error;
    return fail("Invalid JSON request body");
  } finally {
    reader.releaseLock();
  }
}

// Admission policy only: parsing, type checking, merging and execution belong to graphql-js.
function admission(args: ValidatedExecutionArgs) {
  if (args.operation.operation !== "query")
    fail("Only Query operations are supported");
  let cost = 0;
  const active = new Set<string>();
  const walk = (
    set: SelectionSetNode,
    parent: GraphQLCompositeType,
    depth: number,
    multiplier: number,
  ) => {
    for (const node of set.selections) {
      if (node.kind === "FragmentSpread") {
        const name = node.name.value;
        if (active.has(name)) fail("Cyclic fragments are unsupported");
        const fragment = args.fragmentDefinitions[name];
        if (!fragment) continue;
        const type = schema.getType(fragment.typeCondition.name.value);
        if (type && isCompositeType(type)) {
          active.add(name);
          walk(fragment.selectionSet, type, depth, multiplier);
          active.delete(name);
        }
        continue;
      }
      if (node.kind === "InlineFragment") {
        const type = node.typeCondition
          ? schema.getType(node.typeCondition.name.value)
          : parent;
        if (type && isCompositeType(type))
          walk(node.selectionSet, type, depth, multiplier);
        continue;
      }
      if (depth > graphQLLimits.depth) fail("Query exceeds depth budget");
      cost += multiplier;
      if (cost > graphQLLimits.fieldCost)
        fail("Query exceeds field cost budget");
      const name = node.name.value;
      const def =
        name === "__typename"
          ? TypeNameMetaFieldDef
          : parent === schema.getQueryType() && name === "__schema"
            ? SchemaMetaFieldDef
            : parent === schema.getQueryType() && name === "__type"
              ? TypeMetaFieldDef
              : isObjectType(parent) || isInterfaceType(parent)
                ? parent.getFields()[name]
                : undefined;
      if (!def) continue;
      const values = getArgumentValues(
        def,
        node,
        args.variableValues,
      ) as Record<string, unknown>;
      let bound = 1;
      if (
        parent === schema.getQueryType() &&
        !name.startsWith("__") &&
        name !== "stats"
      ) {
        if (name === "search") {
          if (
            typeof values.q !== "string" ||
            !values.q.trim() ||
            values.q.length > 2000
          )
            fail("Search q must have 1..2000 characters");
          if (
            typeof values.limit !== "number" ||
            values.limit < 1 ||
            values.limit > 50
          )
            fail("Search limit must be 1..50");
          bound = values.limit;
          if (
            values.lang != null &&
            !["fr", "en", "ja", "und"].includes(String(values.lang))
          )
            fail("Unsupported language");
        } else {
          bound = page(values).limit;
          if (
            name === "media" &&
            values.provider != null &&
            !["netflix", "youtube"].includes(String(values.provider))
          )
            fail("Unsupported media provider");
        }
      }
      let output = def.type;
      if (isNonNullType(output)) output = output.ofType;
      // Introspection cardinalities derive from the finite schema, not client pagination.
      if (isListType(output) && parent !== schema.getQueryType()) {
        if (parent.name === "__Schema")
          bound =
            name === "types"
              ? Object.keys(schema.getTypeMap()).length
              : schema.getDirectives().length;
        else if (parent.name === "__Type")
          bound =
            name === "fields"
              ? maxFields
              : name === "enumValues"
                ? maxEnumValues
                : name === "inputFields"
                  ? maxInputFields
                  : types.length;
        else bound = maxArgs;
      }
      const type = getNamedType(def.type);
      if (node.selectionSet && isCompositeType(type))
        walk(node.selectionSet, type, depth + 1, multiplier * bound);
    }
  };
  walk(args.operation.selectionSet, schema.getQueryType()!, 1, 1);
}
function response(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "content-type": "application/graphql-response+json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}
export async function handleGraphQL(
  archive: Archive,
  request: Request,
): Promise<Response> {
  try {
    let input: unknown;
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (new TextEncoder().encode(url.search).length > graphQLLimits.bodyBytes)
        fail("Request exceeds 128 KiB");
      let variables: unknown;
      try {
        variables = url.searchParams.has("variables")
          ? JSON.parse(url.searchParams.get("variables")!)
          : undefined;
      } catch {
        fail("Invalid variables JSON");
      }
      input = {
        query: url.searchParams.get("query"),
        operationName: url.searchParams.get("operationName") ?? undefined,
        variables,
      };
    } else if (request.method === "POST") {
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return response(
          {
            errors: [{ message: "Content-Type application/json is required" }],
          },
          415,
        );
      if (
        Number(request.headers.get("content-length")) > graphQLLimits.bodyBytes
      )
        fail("Request body exceeds 128 KiB");
      input = await requestBody(request);
    } else
      return response(
        { errors: [{ message: "Only GET and POST are supported" }] },
        405,
        { Allow: "GET, POST" },
      );
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Expected one GraphQL request object; batching is unsupported");
    const body = input as Record<string, unknown>;
    if (
      typeof body.query !== "string" ||
      new TextEncoder().encode(body.query).length > graphQLLimits.sourceBytes
    )
      fail("query must be a string of at most 32 KiB");
    if (body.operationName != null && typeof body.operationName !== "string")
      fail("operationName must be a string");
    if (
      body.variables != null &&
      (typeof body.variables !== "object" || Array.isArray(body.variables))
    )
      fail("variables must be an object");
    // Bound syntax nesting before reference validation's recursive visitors run.

    // The parser owns syntax. Its token cap bounds input; iterative AST inspection bounds validator recursion.
    let document;
    try {
      document = parse(body.query, { maxTokens: graphQLLimits.tokens });
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      fail("Query cannot be parsed within request limits");
    }
    const stack: Array<[unknown, number]> = [[document, 0]];
    while (stack.length) {
      const [value, depth] = stack.pop()!;
      if (depth > 128) fail("Query syntax exceeds nesting budget");
      if (!value || typeof value !== "object") continue;
      for (const [key, child] of Object.entries(value)) {
        if (key === "loc") continue;
        if (Array.isArray(child))
          for (const item of child) stack.push([item, depth + 1]);
        else if (child && typeof child === "object")
          stack.push([child, depth + 1]);
      }
    }
    const errors = validate(schema, document, undefined, { maxErrors: 50 });
    if (errors.length)
      return response({ errors: errors.map((e) => e.toJSON()) }, 400);
    const root = Object.create(null);
    for (const name of Object.keys(schema.getQueryType()!.getFields()))
      root[name] = (args: Record<string, unknown>) =>
        resolveRoot(archive, { name, args });
    const executionArgs = {
      schema,
      document,
      rootValue: root,
      variableValues: (body.variables ?? undefined) as
        Record<string, unknown> | undefined,
      operationName: (body.operationName ?? undefined) as string | undefined,
    };
    const validated = validateExecutionArgs(executionArgs);
    if (Array.isArray(validated))
      return response({ errors: validated.map((e) => e.toJSON()) }, 400);
    admission(validated as ValidatedExecutionArgs);
    const result = await execute(executionArgs);
    const formatted = {
      ...result,
      ...(result.errors
        ? {
            errors: result.errors.map((e) =>
              e.path
                ? new GraphQLError("GraphQL execution failed", {
                    nodes: e.nodes,
                    path: e.path,
                    extensions: { code: "INTERNAL_SERVER_ERROR" },
                  }).toJSON()
                : e.toJSON(),
            ),
          }
        : {}),
    };
    return response(formatted, Object.hasOwn(result, "data") ? 200 : 400);
  } catch (error) {
    return error instanceof GraphQLError
      ? response({ errors: [error.toJSON()] }, 400)
      : response(
          { errors: [{ message: "GraphQL request processing failed" }] },
          500,
        );
  }
}
