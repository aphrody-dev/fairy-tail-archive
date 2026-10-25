import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  koharuStatus,
  koharuPlan,
  exportKoharuProject,
} from "../packages/scene/koharu.ts";

test("Koharu status reports an absent SDK without claiming neural 3D or opening a port", async () => {
  const status = await koharuStatus({
    binary: resolve("data/not-installed-koharu-sdk.exe"),
  });
  expect(status.available).toBe(false);
  expect(status.documentModel).toBe("2d-pages");
  expect(status.neural3d).toBe(false);
  expect(status.port).toBe(null);
});

test("Koharu import recipe uses the real native method contract and keeps geometry with the SDK", () => {
  const recipe = koharuPlan("Fairy Tail accueil", ["C:/images/natsu.png"]);
  expect(recipe.map((request) => request.method)).toEqual([
    "project.create",
    "project.importPaths",
    "project.pages",
    "project.info",
    "project.close",
  ]);
  expect(recipe[1]!.params).toEqual({ paths: ["C:/images/natsu.png"] });
  let rejected = false;
  try {
    koharuPlan("../escape", ["image.png"]);
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("Missing native Koharu engine refuses project export instead of manufacturing a scene schema", async () => {
  let error = "";
  try {
    await exportKoharuProject({
      name: "Fairy Tail",
      images: ["data/frames/natsu.png"],
      binary: resolve("data/not-installed-koharu-sdk.exe"),
    });
  } catch (e) {
    error = String(e);
  }
  expect(error).toContain("aucun SDK natif qualifié");
});

const binary = Bun.env.KOHARU_TEST_BIN,
  image = Bun.env.KOHARU_TEST_IMAGE;
(binary && image ? test : test.skip)(
  "Installed Koharu SDK creates an actual project from a local image",
  async () => {
    const root = mkdtempSync(resolve("data/koharu-test-"));
    try {
      const result = await exportKoharuProject({
        name: "Fairy Tail fixture",
        images: [image!],
        binary,
        root: resolve(root, "projects"),
        outputRoot: resolve(root, "presets"),
      });
      expect(result.native).toBe(true);
      expect(result.pages).toHaveLength(1);
      const reference = (await Bun.file(result.referencePath).json()) as {
        kind: string;
        projectPath: string;
      };
      expect(reference.kind).toBe("koharu-project-reference");
      expect(reference.projectPath).toBe(result.projectPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
