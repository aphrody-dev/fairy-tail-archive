import { test, expect } from "bun:test";
import {
  configuredShenronLibrary,
  shenronStatus,
  chunkWithShenron,
} from "../packages/native-ai/shenron.ts";
const configured = await configuredShenronLibrary();
(configured ? test : test.skip)(
  "real Shenron Rust ABI chunks Fairy Tail without loading its domain corpus",
  async () => {
    const status = await shenronStatus();
    expect(status.available).toBe(true);
    expect("domainCorpusLoaded" in status && status.domainCorpusLoaded).toBe(
      false,
    );
    const result = await chunkWithShenron(
      "# Fairy Tail\n\nナツ utilise le feu.",
    );
    expect(result.abi).toBeGreaterThan(1);
    expect(result.chunks[0]?.section).toBe("Fairy Tail");
    expect(result.chunks.map((c) => c.content).join(" ")).toContain(
      "ナツ utilise le feu.",
    );
    let rejected = false;
    try {
      await chunkWithShenron("bad\0text");
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  },
);
