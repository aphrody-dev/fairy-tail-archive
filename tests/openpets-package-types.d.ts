// Narrow host declarations for the package preflight; application-wide shims stay unchanged.
declare module "node:fs/promises" {
  type DirEntry = {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  };
  export function lstat(path: string): Promise<DirEntry>;
  export function readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<DirEntry[]>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string): Promise<void>;
  export function rm(
    path: string,
    options: { recursive: true; force: true },
  ): Promise<void>;
}
declare module "node:path" {
  export function join(...paths: string[]): string;
  export function basename(path: string): string;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:buffer" {
  export const Buffer: { from(value: ArrayBuffer): Uint8Array };
}
