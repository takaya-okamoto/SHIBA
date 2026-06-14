import { describe, expect, it } from "vitest";
import { SessionManager, type SessionSink } from "./manager.js";
import { defaultPolicy } from "./session.js";

function fakeSink() {
  const calls: { transcript: string; date: string }[] = [];
  const sink: SessionSink = {
    async closeSession(transcript, date) {
      calls.push({ transcript, date });
      return 0;
    },
  };
  return { sink, calls };
}

describe("SessionManager", () => {
  it("accumulates owner messages and flushes the prior session on the idle boundary", async () => {
    let t = 1_000_000;
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => t);
    await m.record("u1", "好きな色は青");
    t += 60_000;
    await m.record("u1", "猫を飼ってる");
    expect(calls).toHaveLength(0); // still one open session
    t += defaultPolicy.idleMs + 1; // long silence
    await m.record("u1", "おはよう"); // crosses idle boundary -> flush prior session
    expect(calls).toHaveLength(1);
    expect(calls[0]?.transcript).toBe("好きな色は青\n猫を飼ってる");
    expect(m.openCount).toBe(1); // the "おはよう" session is now open
  });

  it("sweep() flushes a session that simply went quiet, and is idempotent", async () => {
    let t = 0;
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => t);
    await m.record("u1", "メモ");
    t += defaultPolicy.idleMs + 1;
    await m.sweep();
    expect(calls).toHaveLength(1);
    await m.sweep(); // nothing left to flush
    expect(calls).toHaveLength(1);
  });

  it("flushes at the turn cap", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, { idleMs: 1e15, maxTurns: 3, dailyResetHour: 4 }, () => 0);
    await m.record("u", "1");
    await m.record("u", "2");
    await m.record("u", "3"); // turnCount == cap
    await m.record("u", "4"); // next record sees the cap -> flush 1..3
    expect(calls).toHaveLength(1);
    expect(calls[0]?.transcript).toBe("1\n2\n3");
  });

  it("flushAll flushes open sessions and skips empty ones", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => 0);
    await m.record("a", "x");
    await m.record("b", "y");
    await m.flushAll();
    expect(calls).toHaveLength(2);
    expect(m.openCount).toBe(0);
  });
});
