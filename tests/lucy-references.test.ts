import { expect, test } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import { createServer } from "../apps/api/main.ts";
import catalog from "../packages/official-sources/generated/view-catalog.json";

test("Lucy references expose sourced works and only registered image routes", async () => {
  const archive = new Archive(":memory:");
  const server = createServer(archive, 0);
  try {
    const response = await fetch(
      new URL("/characters/lucy/references", server.url),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("lucy-heartfilia");
    expect(
      data.sources.some((s: { work: string }) =>
        s.work.includes("RE:FANTASIA"),
      ),
    ).toBe(true);
    expect(data.images).toHaveLength(4);
    for (const image of data.images) {
      const source = catalog.sources.find((s) => s.id === image.sourceId);
      expect(source?.images[image.assetIndex]?.url).toBe(image.imageUrl);
      expect(image.localUrl).toBe(
        `/references/${image.sourceId}/${image.assetIndex}`,
      );
      expect(image.work.includes("RE:FANTASIA")).toBe(false);
      expect(image.rights).toContain("non vérifiées");
    }
    const spec = await (
      await fetch(new URL("/openapi.json", server.url))
    ).json();
    expect(
      spec.paths["/characters/lucy/references"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/LucyReferences");
    expect(JSON.stringify(data).includes("C:/")).toBe(false);
    expect(
      (
        await fetch(new URL("/characters/lucy/references", server.url), {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  } finally {
    server.stop(true);
    archive.close();
  }
});
