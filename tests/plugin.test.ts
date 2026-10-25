import { test, expect } from "bun:test";
import {
  mcpConfiguration,
  configurePlugin,
} from "../plugin/scripts/configure.ts";

type Manifest = {
  name: string;
  version: string;
  skills?: string;
  mcpServers?: string;
  extensions?: { "com.openai": { onboardingSkill: string; review: unknown } };
};
const root = new URL("../plugin/", import.meta.url);
const skills = ["fairy-tail", "fairy-tail-japanese", "fairy-tail-media"];

test("plugin manifests reference real skills and share a local identity", async () => {
  const manifests = [];
  for (const path of [
    "plugin.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "openai/plugin.json",
  ]) {
    const manifest = (await Bun.file(new URL(path, root)).json()) as Manifest;
    manifests.push(manifest);
    expect(manifest.name).toBe("fairy-tail");
    expect(manifest.version).toBe("0.1.0");
    if (manifest.skills) {
      expect(manifest.skills).toBe("./skills/");
      expect(manifest.mcpServers).toBe("./.mcp.json");
    }
  }
  const openai = manifests[3]!.extensions!["com.openai"];
  expect(
    (
      await Bun.file(
        new URL(openai.onboardingSkill, new URL("openai/", root)),
      ).text()
    ).length,
  ).toBeGreaterThan(0);
  for (const skill of skills) {
    const canonical = await Bun.file(
      new URL(`skills/${skill}/SKILL.md`, root),
    ).text();
    const bundled = await Bun.file(
      new URL(`openai/skills/${skill}/SKILL.md`, root),
    ).text();
    expect(canonical.startsWith(`---\nname: ${skill}\n`)).toBe(true);
    expect(/^description:\s+.+$/m.test(canonical)).toBe(true);
    expect(bundled).toBe(canonical);
    expect(canonical.includes("[TODO:")).toBe(false);
  }
});

test("MCP paths resolve from the checkout rather than the client's working directory", async () => {
  const config = (await Bun.file(
    new URL(".mcp.json", root),
  ).json()) as ReturnType<typeof mcpConfiguration>;
  expect(config).toEqual(mcpConfiguration());
  expect(config.mcpServers["fairy-tail"].type).toBe("stdio");
  expect(config.mcpServers["fairy-tail"].command).toBe("bun");
  expect(config.mcpServers["fairy-tail"].args).toHaveLength(1);
  expect(
    (await Bun.file(config.mcpServers["fairy-tail"].args[0]!).text()).length,
  ).toBeGreaterThan(0);
  const relocated = mcpConfiguration(
    new URL("file:///tmp/another%20checkout/"),
  );
  expect(relocated.mcpServers["fairy-tail"].args[0]).toBe(
    "/tmp/another checkout/apps/mcp/main.ts",
  );
  expect(relocated.mcpServers["fairy-tail"].env.ARCHIVE_DB).toBe(
    "/tmp/another checkout/data/archive.sqlite",
  );
});

test("plugin configuration contains no inherited runtime endpoint or generated placeholders", async () => {
  for (const path of [
    ".mcp.json",
    "openai/mcp.json",
    "plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "openai/plugin.json",
    "references/tools.md",
  ]) {
    const content = await Bun.file(new URL(path, root)).text();
    expect(/dragonballfr\.com|shenron-mcp|dragonball\./i.test(content)).toBe(
      false,
    );
    expect(content.includes("example.com")).toBe(false);
    expect(content.includes("composerIcon")).toBe(false);
  }
  const result = await configurePlugin(true);
  expect(result.changed).toEqual([]);
});
