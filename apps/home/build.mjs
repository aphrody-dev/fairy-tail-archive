import { resolve } from "node:path";
import { tailwind } from "@aphrody/bun-plugin-tailwind";
export async function buildHome(options = {}) {
  const directory = resolve(
    options.outdir ?? import.meta.dir + "/../../target/home",
  );
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/index.html"],
    root: import.meta.dir,
    outdir: directory,
    publicPath: "/home/",
    target: "browser",
    minify: true,
    sourcemap: "external",
    plugins: [tailwind({ base: import.meta.dir })],
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Unified experience build failed");
  return {
    directory,
    indexPath: resolve(directory, "index.html"),
    assets: result.outputs.map((output) => ({
      path: output.path,
      size: output.size,
      kind: output.kind,
    })),
  };
}
if (import.meta.main)
  try {
    console.log(JSON.stringify(await buildHome(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
