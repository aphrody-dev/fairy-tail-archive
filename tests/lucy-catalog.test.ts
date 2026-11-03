import { expect, test } from "bun:test";
import { lucyReferences } from "../packages/official-sources/lucy.ts";
import { createOpenAPI } from "../packages/api-contract/openapi.ts";
import catalog from "../packages/official-sources/generated/view-catalog.json";

test("Lucy references resolve to the observed catalog and retain work boundaries", () => {
  const data = lucyReferences();
  expect(data.id).toBe("lucy-heartfilia");
  expect(data.images.length).toBe(4);
  for (const image of data.images) {
    const source = catalog.sources.find((s) => s.id === image.sourceId);
    expect(source?.images[image.assetIndex]?.url).toBe(image.imageUrl);
    expect(image.localUrl).toBe(
      `/references/${image.sourceId}/${image.assetIndex}`,
    );
    expect(image.work.includes("RE:FANTASIA")).toBe(false);
  }
  expect(
    data.sources.some((source) => source.work === data.requestedWork),
  ).toBe(true);
  expect(data.limitations.length).toBeGreaterThan(0);
  expect(
    JSON.stringify(createOpenAPI().paths["/characters/lucy/references"]),
  ).toContain("LucyReferences");
});
