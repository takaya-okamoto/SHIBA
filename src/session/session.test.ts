import { describe, expect, it } from "vitest";
import { type SessionPolicy, type SessionState, defaultPolicy, shouldClose } from "./session.js";

const base = (over: Partial<SessionState> = {}): SessionState => ({
  startedAt: 0,
  lastMessageAt: 0,
  turnCount: 1,
  ...over,
});

describe("shouldClose", () => {
  const now = Date.parse("2026-06-13T12:00:00+09:00");

  it("stays open within idle + turn limits", () => {
    expect(shouldClose(base({ lastMessageAt: now - 60_000, turnCount: 3 }), now)).toBe(false);
  });
  it("closes after idle timeout", () => {
    expect(shouldClose(base({ lastMessageAt: now - (defaultPolicy.idleMs + 1) }), now)).toBe(true);
  });
  it("closes at turn cap", () => {
    expect(shouldClose(base({ lastMessageAt: now - 1000, turnCount: 50 }), now)).toBe(true);
  });
  it("closes across a daily reset (TZ-robust: 2-day span, idle/turn suppressed)", () => {
    const huge: SessionPolicy = { idleMs: Number.MAX_SAFE_INTEGER, maxTurns: Number.MAX_SAFE_INTEGER, dailyResetHour: 4 };
    const prev = Date.parse("2026-06-13T12:00:00Z");
    expect(shouldClose(base({ lastMessageAt: prev }), prev + 2 * 86_400_000, huge)).toBe(true);
  });
});
