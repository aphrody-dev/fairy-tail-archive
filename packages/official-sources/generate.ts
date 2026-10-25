import {
  extractPage,
  hash,
  observeCss,
  parseRegistry,
  themeFrom,
  readablePair,
} from "./extract";
import type { OfficialCatalog, OfficialSource } from "./types";
import { sources as configuredWebSources } from "../crawler/sources";

const registryPath = new URL("../../replica/sources.csv", import.meta.url);
const registry = await Bun.file(registryPath).text();
// Only first-party/rights-holder evidence is eligible. Secondary historical leads
// remain in recon, not in the generated official-content interface.
const allowed = new Set([
  "source_officielle_releve_initial",
  "officiel",
  "editeur",
  "editeur_boutique",
  "fabricant",
  "fabricant_mentions_droits",
  "fabricant_produits_officiels",
  "fabricant_communique",
  "collaboration_marque",
  "fabricant_collaboration",
  "plateforme_mentions_ayant_droit",
  "boutique_editeur",
  "distributeur_officiel",
  "diffuseur_mentions_droits",
  "mentions_droits_operateur",
  "communique_editeur",
]);
const selected = new Set(
  (
    Bun.argv.find((argument) => argument.startsWith("--ids="))?.slice(6) ??
    "W01,W02,W11,W16,W20,W24,W53,W54,W79,wikipedia-en"
  ).split(","),
);
if (selected.size > 12)
  throw new Error(
    "At most twelve explicit pages per generation; no recursive discovery",
  );
const rows = parseRegistry(registry);
const secondarySources = configuredWebSources.filter((source) =>
  /^(wikipedia|fandom)-/.test(source.id),
);
for (const source of secondarySources)
  rows.push({
    id: source.id,
    url: source.seeds[0]!,
    language: source.language,
    category: "wiki",
    operator: new URL(source.seeds[0]!).hostname,
    evidence_url: "packages/crawler/sources.ts",
    availability: "configured_secondary",
    officiality: "configured_wiki",
  });
// Explicit registry-wide run requested by the user; still no discovered-link crawl.
if (Bun.argv.includes("--all")) {
  selected.clear();
  for (const row of rows)
    if (allowed.has(row.officiality!) || row.officiality === "configured_wiki")
      selected.add(row.id!);
}
if (
  [...selected].some(
    (id) =>
      !rows.some(
        (row) =>
          row.id === id &&
          (allowed.has(row.officiality!) ||
            row.officiality === "configured_wiki"),
      ),
  )
)
  throw new Error(
    "Selected ID absent from eligible official/explicit secondary sources",
  );

async function boundedFetch(url: string, maxBytes: number) {
  const original = new URL(url);
  let current = original;
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "FairyTailSourceReferences/1.0 (bounded metadata observation)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect without location");
      const next = new URL(location, current);
      if (
        next.protocol !== "https:" ||
        next.username ||
        next.password ||
        next.hostname.replace(/^www\./, "") !==
          original.hostname.replace(/^www\./, "")
      )
        throw new Error(
          "Cross-site redirect requires separate official evidence",
        );
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("Response exceeds byte budget");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response stream");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maxBytes) throw new Error("Response exceeds byte budget");
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const head = new TextDecoder().decode(bytes.subarray(0, 8192));
    const charset =
      /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1] ??
      /<meta[^>]+charset\s*=\s*["']?([^\s;"'>]+)/i.exec(head)?.[1] ??
      "utf-8";
    const body = new TextDecoder(charset).decode(bytes);
    return {
      body,
      url: current.href,
      status: response.status,
      type: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error("Redirect budget exceeded");
}

const catalog: OfficialCatalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  registryHash: hash(registry),
  collectedIds: [...selected],
  sources: [],
  excluded: [],
};
const previousFile = Bun.file(
  new URL("./generated/catalog.json", import.meta.url),
);
const previous: OfficialCatalog | null = (await previousFile.exists())
  ? ((await previousFile.json()) as OfficialCatalog)
  : null;
if (previous?.registryHash === catalog.registryHash)
  catalog.collectedIds = [...new Set([...previous.collectedIds, ...selected])];
const cssCache = new Map<string, Awaited<ReturnType<typeof boundedFetch>>>();
async function collectSource(row: Record<string, string>) {
  if (!allowed.has(row.officiality!) && row.officiality !== "configured_wiki") {
    catalog.excluded.push({ id: row.id!, reason: row.officiality! });
    return;
  }
  const retained = previous?.sources.find(
    (item) => item.id === row.id && item.url === row.url,
  );
  if (
    !selected.has(row.id!) &&
    retained &&
    previous?.registryHash === catalog.registryHash
  ) {
    catalog.sources.push(retained);
    return;
  }
  const registryLanguage = row.language?.split(/[\s/]+/)[0]?.toLowerCase();
  const source: OfficialSource = {
    id: row.id!,
    sourceClass:
      row.category === "wiki"
        ? "wiki"
        : row.category === "streaming"
          ? "streaming"
          : row.category === "scan"
            ? "scan"
            : "official",
    url: row.url!,
    finalUrl: null,
    category: row.category!,
    operator: row.operator!,
    language:
      registryLanguage && /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(registryLanguage)
        ? registryLanguage
        : null,
    declaredLanguage: null,
    registryEvidence: row.evidence_url!,
    registryAvailability: row.availability!,
    status: "not_collected",
    httpStatus: null,
    observedAt: null,
    contentHash: null,
    title: null,
    description: null,
    fieldSelectors: { title: null, description: null },
    images: [],
    fontStylesheets: [],
    stylesheets: [],
    declarations: [],
    theme: {},
    error: null,
  };
  catalog.sources.push(source);
  if (!selected.has(source.id)) return;
  source.observedAt = new Date().toISOString();
  try {
    const response = await boundedFetch(source.url, 1_500_000);
    source.httpStatus = response.status;
    source.finalUrl = response.url;
    if (!/text\/html/i.test(response.type))
      throw new Error("Expected public HTML");
    if (
      /just a moment|cf-chl-|challenge-platform|access denied/i.test(
        response.body.slice(0, 15000),
      )
    )
      throw new Error("Challenge/error page, not official content");
    const page = await extractPage(response.body, response.url);
    source.contentHash = hash(response.body);
    source.title = page.title;
    source.description = page.description;
    source.declaredLanguage = page.declaredLanguage;
    source.fieldSelectors = page.fieldSelectors;
    source.images = page.images;
    source.fontStylesheets = page.fontStylesheets;
    if (!source.title)
      throw new Error(
        "Page has no source title; no replacement text is generated",
      );
    if (!source.language && page.declaredLanguage)
      source.language = page.declaredLanguage;
    for (const [index, inline] of page.inlineStyles.entries())
      source.declarations.push(
        ...observeCss(inline, `${response.url}#inline-style-${index + 1}`),
      );
    // Two explicitly linked first-party stylesheets per page, no recursive @import.
    const rank = (url: string) =>
      /base|common/i.test(url) ? 3 : /style|main/i.test(url) ? 2 : 1;
    for (const stylesheetUrl of page.stylesheets
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, 2)) {
      try {
        const stylesheet =
          cssCache.get(stylesheetUrl) ??
          (await boundedFetch(stylesheetUrl, 1_000_000));
        cssCache.set(stylesheetUrl, stylesheet);
        if (!/text\/css/i.test(stylesheet.type))
          throw new Error("Expected CSS");
        const observed = observeCss(stylesheet.body, stylesheet.url);
        source.stylesheets.push({
          url: stylesheet.url,
          status: stylesheet.status,
          contentHash: hash(stylesheet.body),
          error: null,
        });
        source.declarations.push(
          ...observed
            .filter((item) =>
              /color|background|font|border|radius|shadow|--/.test(
                item.property,
              ),
            )
            .slice(0, 400),
        );
        for (const family of observed.filter(
          (item) => item.property === "font-family",
        )) {
          if (
            !source.declarations.some(
              (item) =>
                item.stylesheetUrl === family.stylesheetUrl &&
                item.line === family.line &&
                item.property === family.property,
            )
          )
            source.declarations.push(family);
        }
      } catch (error) {
        source.stylesheets.push({
          url: stylesheetUrl,
          status: null,
          contentHash: null,
          error: String(error),
        });
      }
    }
    source.theme = themeFrom(source.declarations);
    source.status = "verified";
  } catch (error) {
    source.status = "unavailable";
    source.error = String(error);
    const status = /HTTP (\d+)/.exec(source.error)?.[1];
    if (status) source.httpStatus = Number(status);
  }
  console.log(
    JSON.stringify({
      id: source.id,
      status: source.status,
      language: source.language,
      title: source.title,
      images: source.images.length,
      declarations: source.declarations.length,
      error: source.error,
    }),
  );
}

const pendingRows = [...rows];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    let row: Record<string, string> | undefined;
    while ((row = pendingRows.shift())) await collectSource(row);
  }),
);
catalog.sources.sort(
  (a, b) =>
    rows.findIndex((row) => row.id === a.id) -
    rows.findIndex((row) => row.id === b.id),
);

const css = [
  "/* Generated from observed, unconditional official CSS declarations. Do not edit. Missing properties use browser-neutral application defaults. */",
];
for (const source of catalog.sources.filter(
  (item) => item.status === "verified",
)) {
  const entries = Object.entries(source.theme);
  if (!entries.length) continue;
  const pair =
    source.theme.canvas &&
    source.theme.ink &&
    readablePair(source.theme.canvas.value, source.theme.ink.value);
  css.push(`[data-ft-source="${source.id}"] {`);
  for (const [key, declaration] of entries) {
    // A single observed foreground/background is insufficient to style a pair.
    // Such values stay available as observations in JSON, never guessed.
    if ((key === "canvas" || key === "ink") && !pair) continue;
    const variable =
      key === "canvas"
        ? "--ft-canvas"
        : key === "ink"
          ? "--ft-ink"
          : "--ft-font-body";
    css.push(
      `  /* ${declaration.stylesheetUrl.replaceAll("*/", "")} | ${declaration.selector.replaceAll("*/", "")} | native AST, no source line mapping | ${declaration.contentHash} */`,
    );
    css.push(`  ${variable}: ${declaration.value};`);
  }
  css.push("}");
}
await Bun.write(
  Bun.file(new URL("./generated/catalog.json", import.meta.url)),
  JSON.stringify(catalog, null, 2) + "\n",
);
// Runtime UI needs source metadata and observed theme declarations, not every CSS rule.
await Bun.write(
  Bun.file(new URL("./generated/view-catalog.json", import.meta.url)),
  JSON.stringify({
    ...catalog,
    sources: catalog.sources.map((source) => ({
      ...source,
      declarations: Object.values(source.theme),
    })),
  }) + "\n",
);
await Bun.write(
  Bun.file(new URL("./generated/themes.css", import.meta.url)),
  css.join("\n") + "\n",
);
console.log(
  JSON.stringify({
    sources: catalog.sources.length,
    verified: catalog.sources.filter((source) => source.status === "verified")
      .length,
    excluded: catalog.excluded.length,
  }),
);
