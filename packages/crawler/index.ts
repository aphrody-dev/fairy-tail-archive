import type { Archive } from "../archive/index.ts";

export const WIKIS = [
  "fairytail.fandom.com",
  "fairytail.fandom.com/fr",
  "fairy-tail.fandom.com/fr",
] as const;
const agent = "FairyTailLocalArchive/0.1 (local research; MediaWiki API)";

export async function crawl(
  archive: Archive,
  options: {
    host?: string;
    maxPages?: number;
    delayMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const host = options.host ?? WIKIS[0];
  if (!(WIKIS as readonly string[]).includes(host))
    throw new Error("Wiki non autorisé");
  const max = options.maxPages ?? 20;
  if (!Number.isInteger(max) || max < 1 || max > 10000)
    throw new Error("maxPages: entier entre 1 et 10000");
  const base = `https://${host}`;
  const request = async (url: string) => {
    options.signal?.throwIfAborted();
    const response = await fetch(url, {
      redirect: "error",
      headers: { "User-Agent": agent },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`Fandom HTTP ${response.status}: arrêt du crawl`);
    if (Number(response.headers.get("content-length")) > 8_000_000)
      throw new Error("Réponse trop volumineuse");
    const body = await response.text();
    if (body.length > 8_000_000) throw new Error("Réponse trop volumineuse");
    return body;
  };
  // Conservative robots policy: stop on any disallow rule applying to API path.
  const robots = await request(`https://${host.split("/")[0]}/robots.txt`);
  if (!robotsAllowed(robots, new URL(`${base}/api.php`).pathname))
    throw new Error("robots.txt interdit l'API");
  let continuation = "",
    count = 0;
  do {
    await Bun.sleep(Math.max(1000, options.delayMs ?? 1000));
    const url = new URL(`${base}/api.php`);
    for (const [k, v] of Object.entries({
      action: "query",
      format: "json",
      generator: "allpages",
      gapnamespace: "0",
      gaplimit: String(Math.min(10, max - count)),
      prop: "extracts|info",
      explaintext: "1",
      inprop: "url",
      ...(continuation ? { gapcontinue: continuation } : {}),
    }))
      url.searchParams.set(k, v);
    const result = JSON.parse(await request(url.href));
    if (result.error) throw new Error(`MediaWiki: ${result.error.info}`);
    if (!result.query?.pages)
      throw new Error("API MediaWiki sans pages/extracts");
    for (const page of Object.values(result.query.pages) as {
      title: string;
      fullurl: string;
      extract?: string;
    }[]) {
      if (!page.extract?.trim()) continue;
      archive.ingest(
        page.fullurl,
        page.title,
        page.extract,
        host.endsWith("/fr") ? "fr" : "en",
      );
      count++;
      if (count >= max) break;
    }
    continuation = result.continue?.gapcontinue ?? "";
  } while (continuation && count < max);
  return { imported: count };
}

export function robotsAllowed(text: string, path: string): boolean {
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).toLowerCase(),
      value = line.slice(colon + 1).trim();
    if (key === "user-agent")
      applies =
        value === "*" || agent.toLowerCase().startsWith(value.toLowerCase());
    if (applies && key === "disallow" && value) {
      const pattern = value
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*");
      if (new RegExp(`^${pattern}`).test(path)) return false;
    }
  }
  return true;
}
