import { type Provenance, trustForProvenance } from "../extract/extract.js";
import type { LlmMessage } from "../llm/client.js";
import type { SourceTrust } from "../types.js";
import type { SessionPersistence } from "./persistence.js";
import {
  type SessionPolicy,
  type SessionState,
  defaultPolicy,
  shouldClose,
  toLocalDate,
} from "./session.js";

/** The half of TurnLoop the manager needs: flush a closed session's transcript to memory. */
export interface SessionSink {
  closeSession(transcript: string, date: string, provenance: Provenance): Promise<number>;
}

interface LiveSession {
  state: SessionState;
  turns: LlmMessage[]; // alternating user/assistant — short-term context for the next reply
  inputs: { text: string; provenance: Provenance }[]; // owner messages + their provenance, for flush
}

/** Default number of recent messages handed back as short-term conversation context (15 exchanges). */
export const HISTORY_WINDOW = 30;

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
    private persist?: SessionPersistence,
  ) {}

  /** Reload sessions left unflushed by a previous run (docs/94 A-1) so the next sweep still
   *  extracts → remembers them. Short-term history isn't restored (a fresh topic is fine). */
  async recover(): Promise<void> {
    if (!this.persist) return;
    for (const [userId, data] of await this.persist.loadAll()) {
      if (this.sessions.has(userId)) continue;
      this.sessions.set(userId, { state: data.state, turns: [], inputs: data.inputs });
    }
  }

  /** Record one exchange (owner message + assistant reply). Flushes the prior session first if it
   *  has crossed its boundary, then appends to the current session. `provenance` rides with the
   *  owner message so the boundary flush can clamp source_trust per span (docs/98 §3.5). */
  async record(
    userId: string,
    userText: string,
    assistantReply: string,
    provenance: Provenance = "owner-typed",
  ): Promise<void> {
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
      s.inputs.push({ text: userText, provenance });
    } else {
      this.sessions.set(userId, {
        state: { startedAt: t, lastMessageAt: t, turnCount: 1 },
        turns: exchange,
        inputs: [{ text: userText, provenance }],
      });
    }
    this.savePersist(userId);
  }

  /** Fire-and-forget persist of the open session's flushable state (never delays a turn). */
  private savePersist(userId: string): void {
    const s = this.sessions.get(userId);
    if (!this.persist || !s) return;
    void this.persist
      .save(userId, { userId, state: s.state, inputs: s.inputs })
      .catch((e) => console.error("session persist:", (e as Error).message));
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
    void this.persist?.remove(userId).catch(() => {}); // session no longer open — drop its state file
    if (s.inputs.length === 0) return;
    const date = toLocalDate(s.state.startedAt);
    // Group owner inputs by trust so a forwarded/pasted span is extracted (and clamped to untrusted)
    // separately from owner-typed text — never mixed into one trusted transcript (docs/98 §3.5).
    const buckets = new Map<SourceTrust, { provenance: Provenance; texts: string[] }>();
    for (const inp of s.inputs) {
      const trust = trustForProvenance(inp.provenance);
      const b = buckets.get(trust) ?? { provenance: inp.provenance, texts: [] };
      b.texts.push(inp.text);
      buckets.set(trust, b);
    }
    for (const b of buckets.values()) {
      try {
        await this.sink.closeSession(b.texts.join("\n"), date, b.provenance);
      } catch (e) {
        console.error("session flush failed:", (e as Error).message);
      }
    }
  }
}
