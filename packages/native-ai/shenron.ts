import { dlopen, FFIType, CString } from "bun:ffi";
import { isAbsolute } from "node:path";

export async function configuredShenronLibrary(): Promise<string | null> {
  if (Bun.env.FAIRY_TAIL_SHENRON_FFI) return Bun.env.FAIRY_TAIL_SHENRON_FFI;
  try {
    const config = (await Bun.file(
      ".config/fairy-tail-native.json",
    ).json()) as { shenronLibrary?: unknown };
    return typeof config.shenronLibrary === "string"
      ? config.shenronLibrary
      : null;
  } catch {
    return null;
  }
}

function open(path: string) {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new Error("An absolute Shenron library path is required");
  return dlopen(path, {
    shenron_abi_version: { args: [], returns: FFIType.u32 },
    shenron_build_info: { args: [], returns: FFIType.ptr },
    shenron_rag_chunk: {
      args: [FFIType.ptr, FFIType.i32, FFIType.f32],
      returns: FFIType.ptr,
    },
    shenron_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  });
}

type Library = ReturnType<typeof open>;
function ownedJSON(library: Library, pointer: number): unknown {
  if (!pointer) throw new Error("Shenron returned a null JSON pointer");
  try {
    return JSON.parse(new CString(pointer).toString());
  } finally {
    library.symbols.shenron_string_free(pointer);
  }
}
function identity(library: Library) {
  const abi = library.symbols.shenron_abi_version();
  const build = ownedJSON(library, library.symbols.shenron_build_info()) as {
    abi?: unknown;
    version?: unknown;
    target?: unknown;
    features?: unknown;
  };
  if (
    abi < 2 ||
    build.abi !== abi ||
    typeof build.version !== "string" ||
    typeof build.target !== "string"
  )
    throw new Error("Incompatible Shenron build identity");
  return { abi, version: build.version, target: build.target };
}

/** Only generic ABI calls are exposed: no global Dragon Ball corpus or persona. */
export async function shenronStatus() {
  const path = await configuredShenronLibrary();
  if (!path)
    return {
      available: false,
      configured: false,
      reason: "Set FAIRY_TAIL_SHENRON_FFI or .config/fairy-tail-native.json",
    };
  try {
    const library = open(path);
    try {
      return {
        available: true,
        configured: true,
        ...identity(library),
        capabilities: ["markdown-chunking"],
        domainCorpusLoaded: false,
      };
    } finally {
      library.close();
    }
  } catch (error) {
    return { available: false, configured: true, error: String(error) };
  }
}

export async function chunkWithShenron(
  markdown: string,
  options: { maxChars?: number; overlapPct?: number } = {},
) {
  if (
    typeof markdown !== "string" ||
    markdown.includes("\0") ||
    new TextEncoder().encode(markdown).byteLength > 128 * 1024
  )
    throw new Error("Markdown must be NUL-free UTF-8 of at most 128 KiB");
  const max = options.maxChars ?? 1500,
    overlap = options.overlapPct ?? 0.1;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > 20000 ||
    !Number.isFinite(overlap) ||
    overlap < 0 ||
    overlap > 0.5
  )
    throw new Error("Invalid native chunk bounds");
  const path = await configuredShenronLibrary();
  if (!path) throw new Error("No Shenron library configured");
  const library = open(path);
  try {
    const build = identity(library);
    const input = new TextEncoder().encode(markdown + "\0");
    const value = ownedJSON(
      library,
      library.symbols.shenron_rag_chunk(input, max, overlap),
    );
    if (
      !Array.isArray(value) ||
      !value.every(
        (c) =>
          c && typeof c.content === "string" && typeof c.section === "string",
      )
    )
      throw new Error("Invalid native chunk response");
    return {
      engine: "shenron-rag/aphrody-rag-core",
      ...build,
      chunks: value as { content: string; section: string }[],
    };
  } finally {
    library.close();
  }
}
