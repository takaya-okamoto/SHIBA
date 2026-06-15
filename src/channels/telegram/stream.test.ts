import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type StreamTransport, capForTelegram, createTelegramStream } from "./stream.js";

describe("capForTelegram", () => {
  it("trims trailing space and passes short text through", () => {
    expect(capForTelegram("hello  ")).toBe("hello");
  });
  it("truncates over-limit text with an ellipsis", () => {
    const out = capForTelegram("a".repeat(5000), 4096);
    expect(out.length).toBe(4096);
    expect(out.endsWith("…")).toBe(true);
  });
});

function fakeTransport() {
  const sends: string[] = [];
  const edits: { id: number; text: string }[] = [];
  let nextId = 100;
  const transport: StreamTransport = {
    send: vi.fn(async (t: string) => {
      sends.push(t);
      return nextId++;
    }),
    edit: vi.fn(async (id: number, t: string) => {
      edits.push({ id, text: t });
    }),
  };
  return { transport, sends, edits };
}

describe("createTelegramStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the first chunk, coalesces rapid updates into one throttled edit, finalizes exact text", async () => {
    const { transport, sends, edits } = fakeTransport();
    const s = createTelegramStream(transport, { throttleMs: 1000 });

    s.update("He");
    await vi.advanceTimersByTimeAsync(0); // first delivery is immediate
    expect(sends).toEqual(["He"]);
    expect(s.messageId()).toBe(100);

    s.update("Hello");
    s.update("Hello wor");
    s.update("Hello world"); // 3 rapid updates -> one edit after the throttle window
    await vi.advanceTimersByTimeAsync(1000);
    expect(edits).toEqual([{ id: 100, text: "Hello world" }]);

    await s.finalize("Hello world, done.");
    expect(edits.at(-1)).toEqual({ id: 100, text: "Hello world, done." });
  });

  it("skips a no-op final edit when nothing changed", async () => {
    const { transport, sends, edits } = fakeTransport();
    const s = createTelegramStream(transport, { throttleMs: 1000 });
    s.update("done");
    await vi.advanceTimersByTimeAsync(0);
    expect(sends).toEqual(["done"]);
    await s.finalize("done"); // identical -> no edit
    expect(edits).toEqual([]);
  });

  it("never sends when there is no text (command / onboarding path)", async () => {
    const { transport, sends } = fakeTransport();
    const s = createTelegramStream(transport, { throttleMs: 1000 });
    await s.finalize("");
    expect(sends).toEqual([]);
    expect(s.messageId()).toBeUndefined();
  });
});
