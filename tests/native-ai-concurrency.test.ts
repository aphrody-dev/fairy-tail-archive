import { test, expect } from "bun:test";
import { callRagCore, cancelNativeCalls } from "../packages/native-ai/index.ts";

test("native command admission caps four children and 32 queued calls, cancels epochs and releases failed spawn slots", async () => {
  const original = Bun.spawn;
  let active = 0,
    peak = 0,
    throwNext = false;
  const records: Array<{
    done: (code?: number) => void;
    isDone: () => boolean;
  }> = [];
  const settle = async () => {
    for (let n = 0; n < 24; n++) await Promise.resolve();
  };
  Bun.spawn = ((_command: unknown, _options: unknown) => {
    if (throwNext) {
      throwNext = false;
      throw new Error("mock spawn failed");
    }
    active++;
    peak = Math.max(peak, active);
    let out!: ReadableStreamDefaultController<Uint8Array>,
      err!: ReadableStreamDefaultController<Uint8Array>,
      exit!: (code: number) => void,
      finished = false;
    const stdout = new ReadableStream<Uint8Array>({
        start(controller) {
          out = controller;
        },
      }),
      stderr = new ReadableStream<Uint8Array>({
        start(controller) {
          err = controller;
        },
      }),
      exited = new Promise<number>((resolve) => {
        exit = resolve;
      });
    const done = (code = 0) => {
      if (finished) return;
      finished = true;
      active--;
      out.enqueue(new TextEncoder().encode("{}"));
      out.close();
      err.close();
      exit(code);
    };
    records.push({ done, isDone: () => finished });
    return {
      stdout,
      stderr,
      exited,
      kill() {
        done(143);
      },
    };
  }) as unknown as typeof Bun.spawn;
  try {
    // Observe every rejection immediately: the 37th call must fail admission.
    const requests = Array.from({ length: 37 }, () =>
      callRagCore("probe", {}).then(
        (value) => ({ ok: true, value, error: "" }),
        (error) => ({ ok: false, value: null, error: String(error) }),
      ),
    );
    await settle();
    expect(records.length).toBe(4);
    expect(active).toBe(4);
    expect(peak).toBe(4);
    expect((await requests[36]!).error).toContain("queue full");
    records[0]!.done();
    await settle();
    expect(records.length).toBe(5);
    expect(active).toBe(4);
    expect(peak).toBe(4);
    await cancelNativeCalls();
    const cancelled = await Promise.all(requests);
    expect(cancelled.filter((result) => result.ok).length).toBe(1);
    expect(
      cancelled.filter((result) => result.error.includes("cancelled")).length,
    ).toBe(31);
    expect(records.length).toBe(5);
    expect(active).toBe(0);
    // A synchronous spawn failure must release its admission slot for the queue.
    throwNext = true;
    const after = Array.from({ length: 5 }, () =>
      callRagCore("probe", {}).then(
        () => "ok",
        (error) => String(error),
      ),
    );
    await settle();
    expect(active).toBe(4);
    expect(peak).toBe(4);
    expect(records.length).toBe(9);
    for (const record of records) if (!record.isDone()) record.done();
    const resumed = await Promise.all(after);
    expect(resumed.filter((result) => result === "ok").length).toBe(4);
    expect(
      resumed.filter((result) => result.includes("mock spawn failed")).length,
    ).toBe(1);
    expect(active).toBe(0);
  } finally {
    // Complete any owned mocks before restoring the real runtime surface.
    for (const record of records) record.done(143);
    await cancelNativeCalls();
    Bun.spawn = original;
  }
}, 10000);
