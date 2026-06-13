/** Session boundary logic (docs/94 A-1). Pure functions — `now` is injected for testability. */

export interface SessionState {
  startedAt: number; // epoch ms
  lastMessageAt: number;
  turnCount: number;
}

export interface SessionPolicy {
  idleMs: number; // close after this much silence (default 4h)
  maxTurns: number; // close after N turns
  dailyResetHour: number; // local hour to force a daily boundary (openclaw daily reset)
}

export const defaultPolicy: SessionPolicy = {
  idleMs: 4 * 60 * 60 * 1000,
  maxTurns: 50,
  dailyResetHour: 4,
};

/**
 * Should the current session close before accepting the next message at `now`?
 * Close = earliest of: idle timeout, turn cap, or crossing the daily reset hour.
 * Closing fires the extraction flush (docs/91 §4).
 */
export function shouldClose(s: SessionState, now: number, p: SessionPolicy = defaultPolicy): boolean {
  if (now - s.lastMessageAt >= p.idleMs) return true;
  if (s.turnCount >= p.maxTurns) return true;
  return crossedDailyReset(s.lastMessageAt, now, p.dailyResetHour);
}

function crossedDailyReset(prev: number, now: number, hour: number): boolean {
  const d = new Date(prev);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= prev) d.setDate(d.getDate() + 1); // next occurrence of the reset hour after prev
  return d.getTime() <= now;
}
