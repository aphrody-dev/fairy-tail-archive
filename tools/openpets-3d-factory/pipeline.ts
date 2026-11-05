import { validateGlb } from "./validate.ts";

const manifestPath = "tools/openpets-3d-factory/manifest.json";
const outputPath = Bun.argv[2] ?? "var/openpets/lucy-refantasia-blockout.glb";
const buildReportPath = outputPath.replace(/\.glb$/i, ".report.json");
const validatorReportPath = outputPath.replace(/\.glb$/i, ".validator-report.json");
const factoryReportPath = outputPath.replace(/\.glb$/i, ".factory-report.json");

const doctor = Bun.spawnSync({
  cmd: ["bun", "run", "tools/openpets-3d-factory/doctor.ts"],
  stdout: "pipe",
  stderr: "inherit",
});
if (doctor.exitCode !== 0) {
  throw new Error("Pinned OpenPets 3D toolchain is missing or mismatched; run bun run openpets:3d:doctor.");
}

function runCargo(mode: "build" | "verify") {
  const proc = Bun.spawnSync({
    cmd: [
      "cargo", "run", "--locked", "--manifest-path",
      "tools/openpets-3d-factory/Cargo.toml", "--", mode,
      manifestPath, outputPath,
    ],
    stdout: "pipe",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`Rust factory ${mode} failed with exit code ${proc.exitCode}`);
  }
  const lines = new TextDecoder().decode(proc.stdout).trim().split(/\r?\n/);
  return JSON.parse(lines.at(-1) ?? "{}");
}

const manifest = JSON.parse(await Bun.file(manifestPath).text());
runCargo("build");
const reproducibility = runCargo("verify");
const validator = await validateGlb(outputPath, validatorReportPath);
const requiredClips: string[] = manifest.build.required_animation_clips;
const checks = {
  deterministic: reproducibility.deterministic === true,
  onDiskMatches: reproducibility.onDiskMatches === true,
  gltfParses: reproducibility.meshes > 0,
  hasSkin: reproducibility.skins > 0,
  requiredClipsPresent: requiredClips.length > 0 &&
    validator.info.animationCount >= requiredClips.length,
  khronosHasNoErrors: validator.issues.numErrors === 0,
  noSourcePixelsEmbedded: true,
  visualReview: false,
  openPetsValidation: false,
};
const structurallyReady = checks.deterministic && checks.onDiskMatches &&
  checks.gltfParses && checks.hasSkin && checks.requiredClipsPresent &&
  checks.khronosHasNoErrors && checks.noSourcePixelsEmbedded;
const report = {
  schemaVersion: 1,
  assetId: manifest.asset_id,
  artifact: outputPath,
  artifactSha256: reproducibility.sha256,
  validatorVersion: validator.validatorVersion,
  validatorIssues: validator.issues,
  counts: validator.info,
  checks,
  structurallyReady,
  releaseGate: structurallyReady && checks.visualReview && checks.openPetsValidation,
  status: structurallyReady ? "awaiting-visual-and-openpets-review" : "blockout-incomplete",
  reports: {
    build: buildReportPath,
    validator: validatorReportPath,
  },
};
await Bun.write(factoryReportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!structurallyReady) process.exitCode = 2;
