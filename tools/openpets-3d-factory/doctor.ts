type Probe = { tool: string; available: boolean; version: string | null; requiredFor: string[] };

const pin = JSON.parse(await Bun.file("tools/openpets-3d-factory/toolchain.json").text()) as {
  bun: string; rustChannel: string; cargoChannel: string; uv: string; blender: string;
};

const probes: Array<{ tool: string; command: string[]; requiredFor: string[] }> = [
  { tool: "bun", command: ["--version"], requiredFor: ["TypeScript orchestration", "OpenPets package validation"] },
  { tool: "rustc", command: ["--version"], requiredFor: ["deterministic geometry and GLB export"] },
  { tool: "cargo", command: ["--version"], requiredFor: ["Rust builds"] },
  { tool: "uv", command: ["--version"], requiredFor: ["Python asset extraction environment"] },
  { tool: "blender", command: ["--version"], requiredFor: ["headless DCC modeling, rigging and GLB interchange"] },
  { tool: "clang++", command: ["--version"], requiredFor: ["optional native image or mesh kernels"] },
  { tool: "cl", command: [], requiredFor: ["optional Windows C/C++ interop"] },
];

const results: Probe[] = probes.map(({ tool, command, requiredFor }) => {
  try {
    const result = Bun.spawnSync({ cmd: [tool, ...command], stdout: "pipe", stderr: "pipe" });
    const output = new TextDecoder().decode(result.stdout).trim()
      || new TextDecoder().decode(result.stderr).trim();
    return { tool, available: result.exitCode === 0, version: output.split(/\r?\n/u)[0] ?? null, requiredFor };
  } catch {
    return { tool, available: false, version: null, requiredFor };
  }
});

const required = new Set(["bun", "rustc", "cargo", "uv", "blender"]);
const missingRequired = results.filter((result) => required.has(result.tool) && !result.available).map((result) => result.tool);
const expected = { bun: pin.bun, rustc: pin.rustChannel, cargo: pin.cargoChannel, uv: pin.uv, blender: pin.blender };
const versionMismatches = results.flatMap((result) => {
  const expectedVersion = expected[result.tool as keyof typeof expected];
  const matches = expectedVersion && result.version && (result.tool === "rustc" || result.tool === "cargo"
    ? result.version.includes(`${expectedVersion.split("-nightly-")[0]}-nightly`)
      && result.version.includes(expectedVersion.split("-nightly-")[1] ?? "")
    : result.version.includes(expectedVersion));
  return expectedVersion && result.version && !matches
    ? [{ tool: result.tool, expected: expectedVersion, actual: result.version }]
    : [];
});
const report = {
  schemaVersion: 1,
  status: missingRequired.length === 0 && versionMismatches.length === 0 ? "pinned-toolchain-ready" : "toolchain-incomplete",
  requiredToolchain: expected,
  optional: ["clang++", "cl"],
  missingRequired,
  versionMismatches,
  tools: results,
  note: "Tool presence does not qualify generated geometry, animation, GLB, or OpenPets package quality.",
};
console.log(JSON.stringify(report, null, 2));
if (missingRequired.length || versionMismatches.length) process.exitCode = 2;
