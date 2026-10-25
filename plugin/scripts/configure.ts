const skills = ["fairy-tail", "fairy-tail-japanese", "fairy-tail-media"];

function localPath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
}

export function mcpConfiguration(
  repository = new URL("../../", import.meta.url),
) {
  return {
    mcpServers: {
      "fairy-tail": {
        type: "stdio",
        command: "bun",
        args: [localPath(new URL("apps/mcp/main.ts", repository))],
        env: {
          ARCHIVE_DB: localPath(new URL("data/archive.sqlite", repository)),
        },
      },
    },
  };
}

export async function configurePlugin(check = false) {
  const mcp = mcpConfiguration();
  const files: Record<string, string> = {
    ".mcp.json": `${JSON.stringify(mcp, null, 2)}\n`,
    "openai/mcp.json": `${JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", ...mcp }, null, 2)}\n`,
    "openai/references/tools.md": await Bun.file(
      new URL("../references/tools.md", import.meta.url),
    ).text(),
  };
  for (const skill of skills)
    files[`openai/skills/${skill}/SKILL.md`] = await Bun.file(
      new URL(`../skills/${skill}/SKILL.md`, import.meta.url),
    ).text();
  const changed: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const url = new URL(`../${path}`, import.meta.url);
    let previous: string | undefined;
    try {
      previous = await Bun.file(url).text();
    } catch {
      /* new generated file */
    }
    if (previous === content) continue;
    if (previous !== undefined && path.endsWith(".json")) {
      try {
        if (
          JSON.stringify(JSON.parse(previous)) ===
          JSON.stringify(JSON.parse(content))
        )
          continue;
      } catch {
        /* invalid generated JSON is drift */
      }
    }
    changed.push(path);
    if (!check) await Bun.write(localPath(url), content);
  }
  return { check, changed };
}

if (import.meta.main) {
  if (Bun.argv.slice(2).some((arg) => arg !== "--check"))
    throw new Error("Usage: bun plugin/scripts/configure.ts [--check]");
  const result = await configurePlugin(Bun.argv.includes("--check"));
  console.log(JSON.stringify(result, null, 2));
  if (result.check && result.changed.length) process.exitCode = 1;
}
