import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePackage } from "../tools/openpets-3d-factory/validate-openpets-package.ts";

const checkout = Bun.env.OPENPETS_SOURCE;
const forkTest = checkout ? test : test.skip;
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

forkTest(
  "uses pinned OpenPets validation without claiming visual qualification",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "openpets-preflight-"));
    const pet = join(root, "example-pet");
    await mkdir(pet);
    const meta = {
      id: "example-pet",
      displayName: "Example",
      description: "Test",
      spritesheetPath: "spritesheet.svg",
      spriteVersionNumber: 2,
    };
    const atlas =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2288" viewBox="0 0 1536 2288"><rect x="0" y="0" width="10" height="10" fill="#fff"/></svg>';
    try {
      await Bun.write(join(pet, "pet.json"), JSON.stringify(meta));
      await Bun.write(join(pet, "spritesheet.svg"), atlas);
      const report = await validatePackage(checkout!, pet);
      expect(report.structuralPreflight).toBe("passed");
      expect(report.releaseQualified).toBe(false);
      expect(report.motionReview).toBe("not-run");
      expect(report.directionReview).toBe("not-run");
      expect(report.atlasSha256).toHaveLength(64);

      await Bun.write(
        join(pet, "spritesheet.svg"),
        atlas.replace("</svg>", "<script/></svg>"),
      );
      expect(await rejects(() => validatePackage(checkout!, pet))).toBe(true);
      await Bun.write(join(pet, "spritesheet.svg"), atlas);
      await Bun.write(
        join(pet, "pet.json"),
        JSON.stringify({ ...meta, spriteVersionNumber: 1 }),
      );
      expect(await rejects(() => validatePackage(checkout!, pet))).toBe(true);
      await Bun.write(join(pet, "pet.json"), JSON.stringify(meta));
      await Bun.write(join(pet, "extra.txt"), "extra");
      expect(await rejects(() => validatePackage(checkout!, pet))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
