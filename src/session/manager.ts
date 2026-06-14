import type { LlmMessage } from "../llm/client.js";
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
  turns: LlmMessage[]; // alternating user/assistant — short-term context for the next reply
}

/** Default number of recent messages handed back as short-term conversation context. */
export const HISTORY_WINDOW = 10;

/**
 * Per-user session tracking (Step 3c). Two jobs:
 *  - short-term context: `recentHistory()` returns the last N messages to seed the next reply.
 *  - long-term memory: at the session boundary (idle / turn cap / daily reset — see session.ts),
 *    the owner-typed lines are flushed via `SessionSink.closeSession` (extract -> remember).
 * `now` is injected so the boundaries are unit-testable.
 */
export class SessionManager {
  private sessions = new Map<string, LiveSession>();

  constructor(
    private sink: SessionSink,
    private policy: SessionPolicy = defaultPolicy,
    private now: () => number = Date.now,
  ) {}

  /** Record one exchange (owner message + assistant reply). Flushes the prior session first if it
   *  has crossed its boundary, then appends to the current session. */
  async record(userId: string, userText: string, assistantReply: string): Promise<void> {
    const t = this.now();
    const cur = this.sessions.get(userId);
    if (cur && shouldClose(cur.state, t, this.policy)) await this.flush(userId);
    const exchange: LlmMessage[] = [
      { role: "user", content: userText },
      { role: "assistant", content: assistantReply },
    ];
    const s = this.sessions.get(userId);
    if (s) {
      s.state.lastMessageAt = t;
      s.state.turnCount += 1;
      s.turns.push(...exchange);
    } else {
      this.sessions.set(userId, {
        state: { startedAt: t, lastMessageAt: t, turnCount: 1 },
        turns: exchange,
      });
    }
  }

  /** Last `n` conversation messages (user+assistant) for short-term context. Empty once the session
   *  has crossed its boundary — a fresh topic shouldn't inherit stale context. */
  recentHistory(userId: string, n = HISTORY_WINDOW): LlmMessage[] {
    const s = this.sessions.get(userId);
    if (!s) return [];
    if (shouldClose(s.state, this.now(), this.policy)) return [];
    return s.turns.slice(-n);
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
    const ownerLines = s.turns.filter((m) => m.role === "user").map((m) => m.content);
    if (ownerLines.length === 0) return;
    try {
      await this.sink.closeSession(ownerLines.join("\n"), toLocalDate(s.state.startedAt));
    } catch (e) {
      console.error("session flush failed:", (e as Error).message);
    }
  }
}
