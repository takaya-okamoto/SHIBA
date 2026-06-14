import {
  type SessionPolicy,
  type SessionState,
  defaultPolicy,
  shouldClose,
  toLocalDate,
} from "./session.js";

/** The half of TurnLoop the manager needs: flush a closed session's transcript to memory. */
export interface SessionSink {
  closeSession(transcript: string, date: string): Promise<number>;
}

interface LiveSession {
  state: SessionState;
  lines: string[]; // owner-typed messages accumulated this session
}

/**
 * Per-user session tracking that fires `SessionSink.closeSession` at the boundary
 * (idle timeout / turn cap / daily reset — see session.ts). This is the scheduling half of
 * Step 3c; the extract→write→commit→reindex work lives in TurnLoop.closeSession.
 *
 * - `record()` is called on each owner message; if the prior session has crossed its boundary it
 *   is flushed first, then a fresh session starts.
 * - `sweep()` should run on an interval so a session that simply goes quiet still gets flushed
 *   without waiting for the user's next message.
 * `now` is injected so the boundaries are unit-testable.
 */
export class SessionManager {
  private sessions = new Map<string, LiveSession>();

  constructor(
    private sink: SessionSink,
    private policy: SessionPolicy = defaultPolicy,
    private now: () => number = Date.now,
  ) {}

  async record(userId: string, text: string): Promise<void> {
    const t = this.now();
    const cur = this.sessions.get(userId);
    if (cur && shouldClose(cur.state, t, this.policy)) await this.flush(userId);
    const s = this.sessions.get(userId);
    if (s) {
      s.state.lastMessageAt = t;
      s.state.turnCount += 1;
      s.lines.push(text);
    } else {
      this.sessions.set(userId, {
        state: { startedAt: t, lastMessageAt: t, turnCount: 1 },
        lines: [text],
      });
    }
  }

  /** Flush every session whose boundary has passed (idle / daily). Call periodically. */
  async sweep(): Promise<void> {
    const t = this.now();
    for (const [userId, s] of [...this.sessions]) {
      if (shouldClose(s.state, t, this.policy)) await this.flush(userId);
    }
  }

  /** Flush all open sessions (e.g. on shutdown). */
  async flushAll(): Promise<void> {
    for (const userId of [...this.sessions.keys()]) await this.flush(userId);
  }

  /** Number of open (unflushed) sessions — for observability/tests. */
  get openCount(): number {
    return this.sessions.size;
  }

  private async flush(userId: string): Promise<void> {
    const s = this.sessions.get(userId);
    if (!s) return;
    this.sessions.delete(userId); // remove first so a failing flush can't loop on sweep
    if (s.lines.length === 0) return;
    try {
      await this.sink.closeSession(s.lines.join("\n"), toLocalDate(s.state.startedAt));
    } catch (e) {
      console.error("session flush failed:", (e as Error).message);
    }
  }
}
