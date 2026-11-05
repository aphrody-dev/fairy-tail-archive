/** Read-only structural preflight using the actual OpenPets fork validator.
 * Usage: bun tools/openpets-3d-factory/validate-openpets-package.ts <openpets-checkout> <pet-directory>
 * A successful result does not qualify motion, gaze semantics, artwork, or GLB.
 */
// lstat is required here: Bun.file().stat() follows symlinks, while this gate
// must reject a package directory or member that redirects outside the package.
import { lstat, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export const OPENPETS_REVISION = "5235d5677f01a941c4479c8c74d084364a7dd1a4";
const SOURCES = ["apps/desktop/src", "packages/install-pet/src"];
const MAX_METADATA = 128 * 1024;
const MAX_ATLAS = 100 * 1024 * 1024;

async function git(root: string, args: string[]): Promise<string> {
  const p = Bun.spawn(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `Cannot verify OpenPets checkout with git: ${stderr.slice(0, 200)}`,
    );
  return stdout.trim();
}

type ForkValidator = {
  validateCodexPetMetadata(
    value: unknown,
    folder: string,
  ): { spritesheetPath: string; spriteVersionNumber?: number };
  validateCodexPetSpritesheet(
    bytes: Uint8Array,
    metadata: { spritesheetPath: string; spriteVersionNumber?: number },
  ): Promise<void>;
};

export async function validatePackage(
  checkoutPath: string,
  packagePath: string,
) {
  const checkout = resolve(checkoutPath);
  const directory = resolve(packagePath);
  const revision = await git(checkout, ["rev-parse", "HEAD"]);
  if (revision !== OPENPETS_REVISION)
    throw new Error(`Unexpected OpenPets revision: ${revision}`);
  if (
    await git(checkout, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ...SOURCES,
    ])
  )
    throw new Error(
      "OpenPets validator source is modified or has untracked files",
    );

  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Package must be a real directory");
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 2 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()))
    throw new Error("Package must contain exactly two regular files");
  const names = entries.map((entry) => entry.name).sort();
  if (!names.includes("pet.json"))
    throw new Error("Package is missing pet.json");
  const metaFile = Bun.file(join(directory, "pet.json"));
  if (metaFile.size > MAX_METADATA)
    throw new Error("pet.json exceeds OpenPets metadata limit");
  const raw: unknown = await metaFile.json();
  const modulePath = join(checkout, "apps/desktop/src/codex-pets-core.ts");
  const validator = (await import(modulePath)) as ForkValidator;
  const metadata = validator.validateCodexPetMetadata(raw, basename(directory));
  if (metadata.spriteVersionNumber !== 2)
    throw new Error("OpenPets v2 metadata required");
  if (!names.includes(metadata.spritesheetPath))
    throw new Error("Selected spritesheet is missing");
  const sprite = Bun.file(join(directory, metadata.spritesheetPath));
  if (sprite.size > MAX_ATLAS)
    throw new Error("Spritesheet exceeds OpenPets size limit");
  const bytes = new Uint8Array(await sprite.arrayBuffer());
  await validator.validateCodexPetSpritesheet(bytes, metadata);
  return {
    schemaVersion: 1,
    openPetsRevision: revision,
    packageId: basename(directory),
    atlas: metadata.spritesheetPath,
    atlasBytes: bytes.byteLength,
    atlasSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    structuralPreflight: "passed",
    motionReview: "not-run",
    directionReview: "not-run",
    glbReview: "not-run",
    releaseQualified: false,
  } as const;
}

if (import.meta.main) {
  const [checkout, directory] = Bun.argv.slice(2);
  if (!checkout || !directory) {
    console.error(
      "Usage: bun validate-openpets-package.ts <openpets-checkout> <pet-directory>",
    );
    process.exitCode = 2;
  } else {
    try {
      console.log(
        JSON.stringify(await validatePackage(checkout, directory), null, 2),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
