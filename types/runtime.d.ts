// Narrow application contracts for the native APIs used here. No npm type package.
// Signatures verified against Aphrody bun-types; this is not a full SDK declaration.
interface ImportMeta {
  main: boolean;
  dir: string;
}
declare const process: {
  chdir(directory: string): void;
  exitCode: number;
  on(event: "SIGINT" | "SIGTERM", callback: () => void): void;
  exit(code: number): never;
};
declare namespace Bun {
  class Archive {
    constructor(bytes: Uint8Array);
    files(pattern?: string | string[]): Promise<Map<string, File>>;
  }
  class Image {
    static readonly available: boolean;
    constructor(
      path: string | Uint8Array,
      options?: { maxPixels?: number; autoOrient?: boolean },
    );
    resize(
      width: number,
      height?: number,
      options?: {
        fit?: "inside" | "cover" | "contain";
        withoutEnlargement?: boolean;
      },
    ): this;
    extract(rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }): this;
    modulate(options: { brightness?: number; saturation?: number }): this;
    webp(options?: { quality?: number; lossless?: boolean }): this;
    png(): this;
    write(path: string): Promise<number>;
    rgba(): Promise<{
      width: number;
      height: number;
      channels: 4;
      data: Uint8Array;
    }>;
    bytes(): Promise<Uint8Array>;
    metadata(): Promise<{ width: number; height: number; format: string }>;
  }
  function hash(value: string): bigint;
  function which(command: string): string | null;
  class VectorIndex {
    static readonly available: boolean;
    constructor(
      path: string,
      options: { dimensions: number; metric?: "l2" | "cosine" },
    );
    readonly count: number;
    readonly dimensions: number;
    add(key: bigint, vector: Float32Array | readonly number[]): void;
    search(
      vector: Float32Array | readonly number[],
      k: number,
      options?: {
        allowedKeys?: BigUint64Array | readonly bigint[];
        ef?: number;
      },
    ): { key: bigint; score: number }[];
    remove(key: bigint): boolean;
    save(): void;
    close(): void;
  }
  function spawn(
    args: string[],
    options: {
      stdout: "pipe";
      stderr: "pipe";
      stdin?: Blob;
      env?: Record<string, string | undefined>;
      cwd?: string;
    },
  ): {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(): void;
  };
  const WebDetect: {
    detect(input: {
      url: string;
      status?: number;
      headers?: Record<string, string>;
      body: string;
    }): {
      challenge: {
        provider: string;
        confidence: string;
        recommendation: string;
        evidence: string[];
      };
    };
  };
  class WebView implements AsyncDisposable {
    constructor(options: {
      backend: { type: "chrome"; url: false };
      width?: number;
      height?: number;
    });
    navigate(url: string): Promise<void>;
    evaluate(expression: string): Promise<unknown>;
    click(selector: string): Promise<void>;
    press(key: string): Promise<void>;
    screenshot(): Promise<Blob>;
    [Symbol.asyncDispose](): Promise<void>;
  }
  const Curl: {
    available: boolean;
    request(
      url: string,
      options: { timeout: number; maxBytes: number; followRedirects: boolean },
    ): Promise<{ status: number }>;
  };
  const Crawl: {
    available: boolean;
    run(options: {
      action: "run";
      store: string;
      seeds: string[];
      maxRequests: number;
      maxSitemaps: number;
      concurrency: number;
      timeout: number;
    }): Promise<{
      attempts?: number;
      errorCount?: number;
      errors?: [string, string][];
    }>;
  };
  const env: Record<string, string | undefined>;
  const stdin: BunFile;
  const stdout: BunFile;
  const argv: string[];
  interface BunFile extends Blob {
    exists(): Promise<boolean>;
    json(): Promise<unknown>;
  }
  function file(path: string | URL): BunFile;
  function write(
    path: string | BunFile,
    data: Uint8Array | string | Response,
  ): Promise<number>;
  function sleep(ms: number): Promise<void>;
  class CryptoHasher {
    constructor(algorithm: "sha256");
    update(data: string | Uint8Array): this;
    digest(encoding: "hex"): string;
  }
  class Glob {
    constructor(pattern: string);
    scan(root: string): AsyncIterable<string>;
  }
  interface VideoMetadata {
    fpsNumerator: number;
    fpsDenominator: number;
    frameCount: number;
    width: number;
    height: number;
    duration: number;
    codec: string;
  }
  class Video {
    static available: boolean;
    constructor(path: string);
    metadata(): Promise<VideoMetadata>;
    frames(options: {
      start: number;
      end: number;
      step: number;
      maxFrames: number;
    }): Promise<{ time: number; bytes: Uint8Array }[]>;
  }
  interface Server {
    url: URL;
    readonly pendingRequests: number;
    stop(closeActiveConnections?: boolean): Promise<void>;
  }
  function serve(options: {
    hostname: string;
    port: number;
    fetch(req: Request): Promise<Response> | Response;
  }): Server;
}
declare module "bun:sqlite" {
  type Binding = string | number | bigint | boolean | null | Uint8Array;
  export class Database {
    constructor(path: string, options?: { strict?: boolean });
    run(sql: string): void;
    query<Row = Record<string, unknown>, Params extends Binding[] = Binding[]>(
      sql: string,
    ): {
      run(...params: Params): unknown;
      get(...params: Params): Row | null;
      all(...params: Params): Row[];
    };
    transaction<T>(fn: () => T): () => T;
    close(): void;
  }
}
declare module "bun:ffi" {
  export const FFIType: {
    u32: "u32";
    ptr: "ptr";
    void: "void";
    i32: "i32";
    f32: "f32";
  };
  export class CString {
    constructor(pointer: number);
    toString(): string;
  }
  export function dlopen<
    T extends Record<string, { args: readonly string[]; returns: string }>,
  >(
    path: string,
    symbols: T,
  ): {
    symbols: {
      [K in keyof T]: (
        ...args: (number | Uint8Array)[]
      ) => T[K]["returns"] extends "void" ? void : number;
    };
    close(): void;
  };
}
declare module "bun:python" {
  interface PythonAsync extends AsyncDisposable {
    run(source: string): Promise<void>;
    evalJSON<T = unknown>(expression: string): Promise<T>;
  }
  export const Python: { async(): Promise<PythonAsync> };
}
declare module "node:fs" {
  export function renameSync(from: string, to: string): void;
  export function unlinkSync(path: string): void;
  export function mkdirSync(
    path: string,
    options: { recursive: true },
  ): string | undefined;
  export function realpathSync(path: string): string;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(
    path: string,
    options: { recursive: true; force: true },
  ): void;
}
declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
}
declare module "bun:test" {
  export function test(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number,
  ): void;
  export namespace test {
    function skip(name: string, fn: () => void | Promise<void>): void;
  }
  interface Matchers {
    toBe(value: unknown): void;
    toEqual(value: unknown): void;
    toHaveLength(value: number): void;
    toContain(value: unknown): void;
    toBeGreaterThan(value: number): void;
  }
  export function expect(value: unknown): Matchers;
}
