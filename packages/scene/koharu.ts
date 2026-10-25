import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Native method contracts verified in koharu-library/src/service.rs, not a 3D scene schema. */
export type KoharuRequest = {
  id: number;
  method:
    | "project.create"
    | "project.importPaths"
    | "project.pages"
    | "project.info"
    | "project.close";
  params: Record<string, unknown>;
};
export type KoharuPage = {
  id: string;
  label: string;
  size: { width: number; height: number };
  source_asset: string | null;
  layer_count: number;
};
const model = {
  documentModel: "2d-pages" as const,
  neural3d: false,
  transport: "stdio-jsonl" as const,
  port: null,
};

async function read(stream: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const part of stream) {
    size += part.byteLength;
    if (size > limit) throw new Error("Réponse Koharu trop volumineuse");
    chunks.push(part);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}
async function sdk(
  binary: string,
  args: string[],
  body?: string,
  home?: string,
) {
  const process = Bun.spawn([binary, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(body === undefined
      ? {}
      : { stdin: new Blob([body], { type: "application/x-ndjson" }) }),
    ...(home ? { env: { ...Bun.env, SHENRON_HOME: home } } : {}),
  });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      process.kill();
    },
    body === undefined ? 10000 : 120000,
  );
  try {
    const [stdout, stderr, code] = await Promise.all([
      read(process.stdout, 8 * 1024 * 1024),
      read(process.stderr, 65536),
      process.exited,
    ]);
    if (timedOut) throw new Error("Délai du SDK Koharu dépassé");
    if (code !== 0)
      throw new Error(`SDK Koharu (${code}): ${stderr.slice(0, 2000)}`);
    return stdout;
  } catch (e) {
    process.kill();
    await process.exited;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function koharuStatus(options: { binary?: string } = {}) {
  const requested =
    options.binary ??
    Bun.env.FAIRY_KOHARU_BIN ??
    Bun.env.SHENRON_KOHARU_SDK_BIN ??
    "koharu-sdk";
  const binary = Bun.which(requested);
  if (!binary)
    return {
      ...model,
      available: false,
      binary: null,
      probe: "missing" as const,
      reason:
        "koharu-sdk absent : configurer FAIRY_KOHARU_BIN ou installer le sidecar natif existant",
      sourceOwner: "koharu-library/koharu-scene",
    };
  try {
    const help = await sdk(binary, ["--help"]);
    if (
      !/Koharu engine over stdio JSON Lines/i.test(help) ||
      !help.includes("--root")
    )
      throw new Error(
        "Le binaire ne présente pas le contrat SDK Koharu attendu",
      );
    return {
      ...model,
      available: true,
      binary,
      probe: "help" as const,
      sourceOwner: "koharu-library/koharu-scene",
      runtimeReadiness: "not_probed",
      methods: [
        "project.create",
        "project.importPaths",
        "project.pages",
        "page.exportPng",
        "page.exportPsd",
      ],
    };
  } catch (e) {
    return {
      ...model,
      available: false,
      binary,
      probe: "help" as const,
      reason: e instanceof Error ? e.message : String(e),
      sourceOwner: "koharu-library/koharu-scene",
    };
  }
}

export function koharuPlan(name: string, images: string[]): KoharuRequest[] {
  name = name.trim();
  if (
    !name ||
    name.length > 120 ||
    /[<>:"/\\|?*]|[. ]$/.test(name) ||
    Array.from(name).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw new Error("Nom de projet Koharu invalide");
  if (
    images.length < 1 ||
    images.length > 64 ||
    images.some((path) => !path || path.includes("\0"))
  )
    throw new Error("Le projet exige de 1 à 64 images locales");
  return [
    { id: 1, method: "project.create", params: { name } },
    { id: 2, method: "project.importPaths", params: { paths: images } },
    { id: 3, method: "project.pages", params: {} },
    { id: 4, method: "project.info", params: {} },
    { id: 5, method: "project.close", params: {} },
  ];
}

/** The Rust SDK owns project creation and its Khrproj format. This adapter writes only a reference. */
export async function exportKoharuProject(options: {
  name: string;
  images: string[];
  root?: string;
  binary?: string;
  outputRoot?: string;
}) {
  koharuPlan(options.name, options.images);
  const status = await koharuStatus({ binary: options.binary });
  if (!status.available || !status.binary)
    throw new Error(
      "Export Koharu indisponible : aucun SDK natif qualifié. Aucun projet 3D ne sera simulé.",
    );
  const images = [];
  for (const source of options.images) {
    const path = realpathSync(resolve(source));
    const metadata = await new Bun.Image(path).metadata();
    if (!(metadata.width > 0 && metadata.height > 0))
      throw new Error(`Image de page invalide: ${path}`);
    images.push({ path, width: metadata.width, height: metadata.height });
  }
  const name = options.name.trim(),
    root = resolve(options.root ?? "data/scene/koharu/projects");
  const output = resolve(options.outputRoot ?? "data/scene/koharu/presets");
  mkdirSync(root, { recursive: true });
  const requests = koharuPlan(
    name,
    images.map((image) => image.path),
  );
  const body =
    requests.map((request) => JSON.stringify(request)).join("\n") + "\n";
  const stdout = await sdk(
    status.binary,
    ["--root", root, "--cpu"],
    body,
    resolve(root, "..", "home"),
  );
  const responses = new Map<number, unknown>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const response = JSON.parse(line) as {
      id?: number;
      error?: unknown;
      result?: unknown;
      event?: string;
    };
    if (typeof response.id !== "number") continue; // SDK events are separate JSONL records.
    if (response.error !== undefined)
      throw new Error(
        `Commande Koharu ${response.id}: ${JSON.stringify(response.error)}`,
      );
    responses.set(response.id, response.result);
  }
  for (const request of requests)
    if (!responses.has(request.id))
      throw new Error(`Réponse du SDK Koharu manquante: ${request.id}`);
  const pages = responses.get(3) as KoharuPage[];
  if (
    !Array.isArray(pages) ||
    pages.length !== images.length ||
    pages.some(
      (page) =>
        typeof page.id !== "string" ||
        !(page.size?.width > 0 && page.size.height > 0),
    )
  )
    throw new Error(
      "Les pages retournées par le SDK Koharu ne correspondent pas aux images importées",
    );
  const projectPath = resolve(root, `${name}.khrproj`);
  // This is an application-owned reference, deliberately not a hand-written Koharu project.
  const reference = {
    version: 1,
    kind: "koharu-project-reference",
    owner: "koharu-library",
    projectPath,
    documentModel: "2d-pages",
    neural3d: false,
    pages,
    images,
  };
  mkdirSync(output, { recursive: true });
  const referencePath = resolve(output, `${name}.koharu-ref.json`);
  await Bun.write(referencePath, JSON.stringify(reference, null, 2));
  return {
    ...model,
    projectPath,
    referencePath,
    pages,
    native: true,
    projectInfo: responses.get(4),
  };
}
