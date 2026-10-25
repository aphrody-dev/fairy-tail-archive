import type {} from "./native";
import type { ObservedDeclaration, SourceAsset } from "./types";

export function hash(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function publicUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** CSV parser for the documentary registry, including quoted newlines/quotes. */
export function parseRegistry(csv: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!;
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (char === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      if (row.some(Boolean)) records.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("Unclosed CSV quoted field");
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    records.push(row);
  }
  const headers = records.shift();
  if (!headers?.includes("url") || !headers.includes("id"))
    throw new Error("Invalid source registry");
  return records.map((fields) => {
    if (fields.length !== headers.length)
      throw new Error("Inconsistent source registry row");
    return Object.fromEntries(
      headers.map((key, index) => [key, fields[index]!]),
    );
  });
}

export async function extractPage(html: string, sourceUrl: string) {
  const document = Bun.HTML.parse(html);
  const titleNode = document.select("title")[0];
  const title = titleNode === undefined ? "" : document.text(titleNode);
  const htmlNode = document.select("html")[0];
  const language =
    htmlNode === undefined ? null : document.attribute(htmlNode, "lang");
  const meta = new Map<string, string>();
  const images: SourceAsset[] = [];
  const stylesheets: string[] = [];
  const inlineStyles: string[] = [];
  const fontStylesheets: string[] = [];
  const addImage = (
    address: string | null,
    alt: string,
    selector: string,
    social = false,
  ) => {
    if (!address) return;
    const url = publicUrl(address, sourceUrl);
    if (!url || images.some((image) => image.url === url)) return;
    const kind = /logo/i.test(url) ? "logo" : social ? "social" : "image";
    images.push({ url, alt, kind, sourceUrl, selector });
  };
  for (const node of document.select("meta")) {
    const key =
      document.attribute(node, "property") ?? document.attribute(node, "name");
    const value = document.attribute(node, "content");
    if (key && value) meta.set(key.toLowerCase(), value);
  }
  for (const node of document.select("img")) {
    const src = document.attribute(node, "src");
    const lazy = document.attribute(node, "data-src");
    addImage(
      src && !src.startsWith("data:") ? src : lazy,
      document.attribute(node, "alt") ?? "",
      src && !src.startsWith("data:") ? "img[src]" : "img[data-src]",
    );
  }
  const unconditionalStyle = (node: number) => {
    const media = document.attribute(node, "media")?.trim().toLowerCase();
    const rel =
      document.attribute(node, "rel")?.toLowerCase().split(/\s+/) ?? [];
    return (
      (!media || media === "all") &&
      !rel.includes("alternate") &&
      document.attribute(node, "disabled") === null
    );
  };
  for (const node of document.select('link[rel~="stylesheet"]')) {
    if (!unconditionalStyle(node)) continue;
    const href = document.attribute(node, "href");
    const url = href ? publicUrl(href, sourceUrl) : null;
    if (!url) continue;
    if (new URL(url).hostname === "fonts.googleapis.com")
      fontStylesheets.push(url);
    else if (new URL(url).origin === new URL(sourceUrl).origin)
      stylesheets.push(url);
  }
  for (const node of document.select("style"))
    if (unconditionalStyle(node)) inlineStyles.push(document.text(node));
  addImage(meta.get("og:image") ?? null, "", 'meta[property="og:image"]', true);
  const ogTitle = meta.get("og:title")?.trim();
  const description =
    meta.get("description") ?? meta.get("og:description") ?? null;
  return {
    title: ogTitle || title.trim() || null,
    description: description?.trim() || null,
    declaredLanguage: language,
    fieldSelectors: {
      title: ogTitle
        ? 'meta[property="og:title"]'
        : title.trim()
          ? "title"
          : null,
      description: meta.has("description")
        ? 'meta[name="description"]'
        : description
          ? 'meta[property="og:description"]'
          : null,
    },
    images: images
      .sort(
        (a, b) =>
          ({ logo: 3, social: 2, image: 1 })[b.kind] -
          { logo: 3, social: 2, image: 1 }[a.kind],
      )
      .slice(0, 40),
    stylesheets: [...new Set(stylesheets)],
    fontStylesheets: [...new Set(fontStylesheets)],
    inlineStyles,
  };
}

/** Native CSS AST observations, not a cascade/computed-style engine.
 * AST serialization may normalize equivalent syntax. Conditions stay explicit.
 * Nothing from these stylesheets is executed or copied wholesale into the app.
 */
export function observeCss(
  css: string,
  stylesheetUrl: string,
): ObservedDeclaration[] {
  const declarations: ObservedDeclaration[] = [];
  const contentHash = hash(css);
  const visit = (body: string, conditions: string[] = []) => {
    for (const rule of Bun.HTML.parseCSS(body)) {
      if (/^@(media|supports|layer|container|scope)\b/.test(rule.prelude)) {
        visit(rule.body, [...conditions, rule.prelude]);
        continue;
      }
      if (
        rule.prelude.startsWith("@") &&
        !rule.prelude.startsWith("@font-face")
      )
        continue;
      let value = "",
        quote = "",
        escaped = false,
        parentheses = 0;
      const flush = () => {
        const colon = value.indexOf(":");
        const property = value.slice(0, colon).trim().toLowerCase();
        const observed = value.slice(colon + 1).trim();
        if (colon > 0 && /^--[\w-]+$|^[a-z-]+$/.test(property) && observed)
          declarations.push({
            property,
            value: observed,
            selector: rule.prelude,
            conditions,
            stylesheetUrl,
            contentHash,
            line: null,
          });
        value = "";
      };
      for (const char of rule.body) {
        if (quote) {
          value += char;
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) quote = "";
          continue;
        }
        if (escaped) {
          value += char;
          escaped = false;
          continue;
        }
        if (char === "\\") {
          value += char;
          escaped = true;
          continue;
        }
        if (char === '"' || char === "'") quote = char;
        if (char === "(") parentheses++;
        if (char === ")") parentheses = Math.max(0, parentheses - 1);
        if (char === ";" && !parentheses) flush();
        else value += char;
      }
      flush();
    }
  };
  visit(css);
  return declarations;
}

export function safeColor(value: string): boolean {
  return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|black|white|transparent|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\))$/i.test(
    value,
  );
}

export function themeFrom(declarations: ObservedDeclaration[]) {
  const theme: Partial<
    Record<"canvas" | "ink" | "fontBody", ObservedDeclaration>
  > = {};
  for (const declaration of declarations) {
    if (
      declaration.conditions.length ||
      !declaration.selector
        .split(",")
        .some((selector) => /^(?:html|body|:root)$/.test(selector.trim()))
    )
      continue;
    const value = declaration.value.replace(/\s*!important\s*$/, "");
    if (
      (declaration.property === "background-color" ||
        declaration.property === "background") &&
      safeColor(value) &&
      value !== "transparent"
    )
      theme.canvas = { ...declaration, value };
    if (
      declaration.property === "color" &&
      safeColor(value) &&
      value !== "transparent"
    )
      theme.ink = { ...declaration, value };
    if (
      declaration.property === "font-family" &&
      /^[\p{L}\p{N}\s,'"._-]+$/u.test(value)
    )
      theme.fontBody = { ...declaration, value };
  }
  return theme;
}

/** Gate only; never synthesizes, adjusts or substitutes source colors. */
export function readablePair(background: string, foreground: string): boolean {
  const luminance = (value: string) => {
    if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value)) return null;
    const hex =
      value.length === 4
        ? [...value.slice(1)].map((char) => char + char).join("")
        : value.slice(1);
    const channels = [0, 2, 4]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return (
      channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    );
  };
  const bg = luminance(background),
    fg = luminance(foreground);
  return (
    bg !== null &&
    fg !== null &&
    (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5
  );
}
