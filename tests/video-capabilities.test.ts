import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Archive } from "../packages/archive/index.ts";
import { indexEpisode } from "../packages/video/index.ts";
import {
  mediaCapabilities,
  planMediaConversion,
  executeMediaConversion,
} from "../packages/video/capabilities.ts";

test("native remux preserves every sample and source frame without pretending to transcode", async () => {
  const a = new Archive(":memory:"),
    root = mkdtempSync(resolve("data/conversion-test-")),
    media = resolve(root, "media"),
    output = resolve(root, "converted");
  mkdirSync(media, { recursive: true });
  try {
    const source = resolve(media, "fixture.mp4");
    await Bun.write(
      source,
      await Bun.file(
        resolve(import.meta.dir, "fixtures/native-silent.mp4"),
      ).bytes(),
    );
    const indexed = await indexEpisode(a, source, {
      mediaRoot: media,
      outputRoot: resolve(root, "frames"),
    });
    const options = { mediaRoot: media, outputRoot: output };
    const plan = await planMediaConversion(a, indexed.id, options);
    expect(plan.reencodes).toBe(false);
    expect(plan.source.scope).toBe("local-media");
    expect(plan.playbackVerified).toBe(false);
    const converted = await executeMediaConversion(a, indexed.id, options);
    expect(converted.reused).toBe(false);
    expect(converted.output.metadata.frameCount).toBe(15);
    expect(converted.output.metadata.fpsNumerator).toBe(15);
    const before = await new Bun.Video(source).frames({
        start: 0,
        end: 1,
        step: 1 / 15,
        maxFrames: 15,
      }),
      after = await new Bun.Video(converted.output.path).frames({
        start: 0,
        end: 1,
        step: 1 / 15,
        maxFrames: 15,
      });
    expect(
      after.map((frame) =>
        new Bun.CryptoHasher("sha256").update(frame.bytes).digest("hex"),
      ),
    ).toEqual(
      before.map((frame) =>
        new Bun.CryptoHasher("sha256").update(frame.bytes).digest("hex"),
      ),
    );
    expect((await executeMediaConversion(a, indexed.id, options)).reused).toBe(
      true,
    );
    expect(mediaCapabilities().operations.transcode.executionEnabled).toBe(
      false,
    );
    for (const invalid of [
      { operation: "hls" as const },
      { operation: "transcode" as const },
      { format: "webm" },
      { maxInputBytes: 1 },
      { maxFrames: 1 },
      { maxOutputBytes: 100 },
    ]) {
      let failed = false;
      try {
        await planMediaConversion(a, indexed.id, { ...options, ...invalid });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    }
    await Bun.write(converted.output.path, "existing output must survive");
    let error = "";
    try {
      await executeMediaConversion(a, indexed.id, options);
    } catch (e) {
      error = String(e);
    }
    expect(error).toContain("aucun écrasement");
    expect(await Bun.file(converted.output.path).text()).toBe(
      "existing output must survive",
    );
    await Bun.write(source, "modified source");
    let rejected = false;
    try {
      await planMediaConversion(a, indexed.id, options);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    a.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
