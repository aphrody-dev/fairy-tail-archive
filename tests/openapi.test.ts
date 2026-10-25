import { test, expect } from "bun:test";
import { createOpenAPI } from "../packages/api-contract/openapi.ts";
import { Archive } from "../packages/archive/index.ts";
import { createServer } from "../apps/api/main.ts";

test("OpenAPI references resolve and templated paths declare required parameters", () => {
  const spec = createOpenAPI("http://127.0.0.1:4321");
  expect(spec.openapi).toBe("3.1.1");
  expect(spec.servers[0]?.url).toBe("http://127.0.0.1:4321");
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.$ref === "string")
      expect(
        Object.hasOwn(spec.components.schemas, record.$ref.split("/").at(-1)!),
      ).toBe(true);
    for (const value of Object.values(record)) walk(value);
  };
  walk(spec);
  for (const [path, methods] of Object.entries(spec.paths))
    for (const method of Object.values(methods)) {
      const operation = method as {
        parameters?: { name: string; in: string; required?: boolean }[];
        responses: Record<string, unknown>;
      };
      expect(
        Object.keys(operation.responses).some((status) =>
          /^[23]\d\d$/.test(status),
        ),
      ).toBe(true);
      for (const match of path.matchAll(/\{([^}]+)\}/g))
        expect(
          operation.parameters?.some(
            (p) =>
              p.name === match[1] && p.in === "path" && p.required === true,
          ),
        ).toBe(true);
    }
});

test("OpenAPI includes public catalogue, GraphQL and cache-only media contracts", () => {
  const spec = createOpenAPI();
  for (const path of [
    "/search",
    "/index/search",
    "/ask",
    "/catalog/books",
    "/catalog/books/status",
    "/catalog/videos",
    "/episodes/{id}/frames",
    "/fancaps",
    "/cdn/fancaps/{id}",
    "/openapi.json",
    "/graphql",
    "/streams",
    "/streams/{streamId}/file",
    "/streams/{streamId}/play",
  ])
    expect(Object.hasOwn(spec.paths, path)).toBe(true);
  const graphql = spec.paths["/graphql"]!;
  expect(Object.hasOwn(graphql, "post")).toBe(true);
  expect(JSON.stringify(spec.paths["/cdn/fancaps/{id}"])).toContain("304");
  expect(JSON.stringify(spec.components.schemas.BookRecord)).toContain(
    "authors_json",
  );
  expect(JSON.stringify(spec.components.schemas.Episode)).toContain(
    "next_frame",
  );
});

test("server publishes its OpenAPI document and executes GraphQL POST", async () => {
  const archive = new Archive(":memory:");
  const server = createServer(archive, 0);
  try {
    const document = await (
      await fetch(new URL("/openapi.json", server.url))
    ).json();
    expect(document.openapi).toBe("3.1.1");
    expect(document.servers[0].url).toBe(server.url.origin);
    const result = await fetch(new URL("/graphql", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{stats{documents}}" }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ data: { stats: { documents: 0 } } });
    const sdl = await fetch(new URL("/graphql/schema", server.url));
    expect(await sdl.text()).toContain("type Query");
  } finally {
    server.stop(true);
    archive.close();
  }
});
