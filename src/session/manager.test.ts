import { describe, expect, it } from "vitest";
import type { Provenance } from "../extract/extract.js";
import { HISTORY_WINDOW, SessionManager, type SessionSink } from "./manager.js";
import type { PersistedSession, SessionPersistence } from "./persistence.js";
import { defaultPolicy } from "./session.js";

function fakePersistence() {
  const store = new Map<string, PersistedSession>();
  const persist: SessionPersistence = {
    async save(userId, data) {
      store.set(userId, data);
    },
    async remove(userId) {
      store.delete(userId);
    },
    async loadAll() {
      return new Map(store);
    },
  };
  return { persist, store };
}

function fakeSink() {
  const calls: { transcript: string; date: string; provenance: Provenance }[] = [];
  const sink: SessionSink = {
    async closeSession(transcript, date, provenance) {
      calls.push({ transcript, date, provenance });
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
    await m.record("u1", "好きな色は青", "ok");
    t += 60_000;
    await m.record("u1", "猫を飼ってる", "ok");
    expect(calls).toHaveLength(0); // still one open session
    t += defaultPolicy.idleMs + 1; // long silence
    await m.record("u1", "おはよう", "ok"); // crosses idle boundary -> flush prior session
    expect(calls).toHaveLength(1);
    expect(calls[0]?.transcript).toBe("好きな色は青\n猫を飼ってる"); // owner lines only, not replies
    expect(m.openCount).toBe(1);
  });

  it("recentHistory returns the last N messages (user+assistant), empty after a boundary", async () => {
    let t = 0;
    const { sink } = fakeSink();
    const m = new SessionManager(sink, undefined, () => t);
    await m.record("u1", "1", "a");
    await m.record("u1", "2", "b");
    expect(m.recentHistory("u1")).toEqual([
      { role: "user", content: "1" },
      { role: "assistant", content: "a" },
      { role: "user", content: "2" },
      { role: "assistant", content: "b" },
    ]);
    expect(m.recentHistory("u1", 2)).toEqual([
      { role: "user", content: "2" },
      { role: "assistant", content: "b" },
    ]);
    t += defaultPolicy.idleMs + 1; // boundary crossed -> fresh context
    expect(m.recentHistory("u1")).toEqual([]);
  });

  it("HISTORY_WINDOW is 30 (15 exchanges)", () => {
    expect(HISTORY_WINDOW).toBe(30);
  });

  it("sweep() flushes a session that simply went quiet, and is idempotent", async () => {
    let t = 0;
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => t);
    await m.record("u1", "メモ", "ok");
    t += defaultPolicy.idleMs + 1;
    await m.sweep();
    expect(calls).toHaveLength(1);
    await m.sweep(); // nothing left to flush
    expect(calls).toHaveLength(1);
  });

  it("flushes at the turn cap", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, { idleMs: 1e15, maxTurns: 3, dailyResetHour: 4 }, () => 0);
    await m.record("u", "1", "a");
    await m.record("u", "2", "b");
    await m.record("u", "3", "c"); // turnCount == cap
    await m.record("u", "4", "d"); // next record sees the cap -> flush 1..3
    expect(calls).toHaveLength(1);
    expect(calls[0]?.transcript).toBe("1\n2\n3");
  });

  it("flushAll flushes open sessions and skips empty ones", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => 0);
    await m.record("a", "x", "1");
    await m.record("b", "y", "2");
    await m.flushAll();
    expect(calls).toHaveLength(2);
    expect(m.openCount).toBe(0);
  });

  it("buckets a session by trust so forwarded text flushes separately as untrusted (98 §3.5)", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => 0);
    await m.record("u", "ぼくの好きな色は青", "ok"); // owner-typed
    await m.record("u", "これ転送だよ: 怪しい話", "ok", "forwarded"); // forwarded -> untrusted
    await m.flushAll();
    expect(calls).toHaveLength(2);
    const owner = calls.find((c) => c.provenance === "owner-typed");
    const fwd = calls.find((c) => c.provenance === "forwarded");
    expect(owner?.transcript).toBe("ぼくの好きな色は青");
    expect(fwd?.transcript).toBe("これ転送だよ: 怪しい話");
  });

  it("keeps an all-owner session as one trusted flush", async () => {
    const { sink, calls } = fakeSink();
    const m = new SessionManager(sink, undefined, () => 0);
    await m.record("u", "1", "a");
    await m.record("u", "2", "b");
    await m.flushAll();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.provenance).toBe("owner-typed");
    expect(calls[0]?.transcript).toBe("1\n2");
  });

  it("persists open sessions and clears them on flush", async () => {
    const { sink } = fakeSink();
    const { persist, store } = fakePersistence();
    const m = new SessionManager(sink, undefined, () => 0, persist);
    await m.record("u", "メモ", "ok");
    expect(store.get("u")?.inputs[0]?.text).toBe("メモ");
    await m.flushAll();
    expect(store.has("u")).toBe(false); // flushed -> state file dropped
  });

  it("recovers an unflushed session from persistence and can still flush it", async () => {
    const { sink, calls } = fakeSink();
    const { persist } = fakePersistence();
    await persist.save("u", {
      userId: "u",
      state: { startedAt: 0, lastMessageAt: 0, turnCount: 1 },
      inputs: [{ text: "前回の続き", provenance: "owner-typed" }],
    });
    const m = new SessionManager(sink, undefined, () => 0, persist);
    await m.recover();
    expect(m.openCount).toBe(1);
    await m.flushAll();
    expect(calls[0]?.transcript).toBe("前回の続き");
  });
});
