import catalogData from "./generated/view-catalog.json";
import type { OfficialCatalog } from "./types";
const catalog = catalogData as OfficialCatalog;
const cache = new Map<
  string,
  { bytes: Uint8Array; mime: string; etag: string }
>();
/** Only image URLs already observed in the source registry can be requested. */
export async function referenceAssetResponse(
  request: Request,
): Promise<Response | null> {
  const match = /^\/references\/([\w-]+)\/([0-9]+)$/.exec(
    new URL(request.url).pathname,
  );
  if (!match) return null;
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const asset = catalog.sources.find((source) => source.id === match[1])
    ?.images[Number(match[2])];
  if (!asset) return new Response("Unknown source asset", { status: 404 });
  let item = cache.get(asset.url);
  if (!item)
    try {
      const response = await fetch(asset.url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const mime = response.headers.get("content-type") ?? "";
      if (!response.ok || !/^image\//i.test(mime))
        return new Response("Source image unavailable", { status: 502 });
      if (Number(response.headers.get("content-length")) > 8 * 1024 * 1024) {
        await response.body?.cancel();
        return new Response("Image exceeds budget", { status: 413 });
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty source image");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.length;
          if (size > 8 * 1024 * 1024) throw new Error("Image exceeds budget");
          parts.push(result.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      item = {
        bytes,
        mime,
        etag: `"${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}"`,
      };
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(asset.url, item);
    } catch {
      return new Response("Source image unavailable", { status: 502 });
    }
  const headers = {
    "Content-Type": item.mime,
    "Content-Length": String(item.bytes.length),
    ETag: item.etag,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === item.etag)
    return new Response(null, { status: 304, headers });
  const body = new Uint8Array(item.bytes.length);
  body.set(item.bytes);
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
