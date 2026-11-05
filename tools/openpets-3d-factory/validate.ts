import { validateBytes } from "gltf-validator";

export async function validateGlb(input: string, output: string) {
  const bytes = new Uint8Array(await Bun.file(input).arrayBuffer());
  const report = await validateBytes(bytes, {
    uri: input.replaceAll("\\", "/"),
    format: "glb",
  });
  await Bun.write(output, JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.main) {
  const input = Bun.argv[2];
  if (!input) {
    throw new Error("usage: bun run validate.ts <asset.glb> [report.json]");
  }
  const output = Bun.argv[3] ?? `${input}.validator-report.json`;
  const report = await validateGlb(input, output);
  console.log(JSON.stringify({
    asset: input,
    output,
    validatorVersion: report.validatorVersion,
    issues: report.issues,
    counts: report.info,
  }, null, 2));
  if (report.issues.numErrors > 0) process.exitCode = 1;
}
