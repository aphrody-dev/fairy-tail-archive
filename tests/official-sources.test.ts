import { expect, test } from "bun:test";
import {
  extractPage,
  observeCss,
  parseRegistry,
  publicUrl,
  readablePair,
  themeFrom,
} from "../packages/official-sources/extract";

test("source color pairs are gated without inventing or adjusting colors", () => {
  expect(readablePair("#fff", "#000")).toBe(true);
  expect(readablePair("#ffffff", "#eeeeee")).toBe(false);
  expect(readablePair("var(--paper)", "#000")).toBe(false);
  expect(readablePair("#ffffff00", "#000")).toBe(false);
});

test("HTML media, alternate and disabled styles cannot become unconditional themes", async () => {
  const page = await extractPage(
    '<title>Source</title><style media="print">body{color:red}</style><style>body{color:black}</style><link rel="alternate stylesheet" href="/alt.css"><link rel="stylesheet" media="print" href="/print.css"><link rel="stylesheet" disabled href="/disabled.css"><link rel="stylesheet" media="all" href="/base.css">',
    "https://official.example/",
  );
  expect(page.inlineStyles).toEqual(["body{color:black}"]);
  expect(page.stylesheets).toEqual(["https://official.example/base.css"]);
});

test("registry preserves quoted commas, newlines and escaped quotes", () => {
  const rows = parseRegistry(
    'id,url,note\nW01,https://official.example/,"line one, ""quoted""\nline two"\n',
  );
  expect(rows).toEqual([
    {
      id: "W01",
      url: "https://official.example/",
      note: 'line one, "quoted"\nline two',
    },
  ]);
  let rejected = false;
  try {
    parseRegistry('id,url\nW01,"broken');
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

test("HTML metadata and image URLs originate in the page, without invented fallback copy", async () => {
  const page = await extractPage(
    '<html lang="ja"><title>公式 &amp; FAIRY TAIL</title><meta name="description" content="原文"><link rel="stylesheet" href="/base.css"><img src="/img/logo.png" alt="ロゴ"><img src="javascript:alert(1)"><script>window.title="fake"</script></html>',
    "https://official.example/ja/",
  );
  expect(page.title).toBe("公式 & FAIRY TAIL");
  expect(page.declaredLanguage).toBe("ja");
  expect(page.description).toBe("原文");
  expect(page.images).toHaveLength(1);
  expect(page.images[0]?.url).toBe("https://official.example/img/logo.png");
  expect(page.stylesheets).toEqual(["https://official.example/base.css"]);
  expect(
    (await extractPage("<html></html>", "https://official.example/")).title,
  ).toBe(null);
});

test("CSS observation keeps conditional rules and string delimiters distinct", () => {
  const declarations = observeCss(
    'body { color: #222; font-family: "Font; Name", sans-serif; background: white; } @media (max-width: 400px) { body { color: red; } } .art { background-image: url("data:image/svg+xml;foo{}"); }',
    "https://official.example/base.css",
  );
  expect(
    declarations.find((item) => item.property === "font-family")?.value,
  ).toBe("Font\\; Name, sans-serif");
  expect(
    declarations.find((item) => item.value === "red")?.conditions[0],
  ).toContain("@media");
  expect(
    declarations.find((item) => item.property === "background-image")?.value,
  ).toBe('url("data:image/svg+xml;foo{}")');
  const theme = themeFrom(declarations);
  expect(theme.ink?.value).toBe("#222");
  expect(theme.canvas?.value).toBe("#fff");
  expect(theme.fontBody).toBe(undefined); // unsafe delimiters never enter generated CSS
});

test("missing, nested and unresolved CSS values are never guessed into brand tokens", () => {
  expect(
    themeFrom(
      observeCss(
        ".card { color: #f00; } body {color:var(--brand);background:url(x);}",
        "https://official.example/style.css",
      ),
    ),
  ).toEqual({});
  expect(publicUrl("javascript:alert(1)", "https://official.example/")).toBe(
    null,
  );
  expect(
    publicUrl(
      "https://user:password@official.example/",
      "https://official.example/",
    ),
  ).toBe(null);
  expect(
    publicUrl("http://official.example/", "https://official.example/"),
  ).toBe(null);
});
