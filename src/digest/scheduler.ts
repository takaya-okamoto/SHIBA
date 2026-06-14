import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type DigestSource, buildDigest } from "./digest.js";

/** Send a message to a registered owner (Telegram, via the adapter). */
export interface Notifier {
  notify(userId: string, text: string): Promise<void>;
}

export interface DigestPolicy {
  enabled: boolean;
  hour: number; // local hour to send the digest (e.g. 8)
  quietStartHour: number; // proactive sends are blocked from here ...
  quietEndHour: number; // ... until here (e.g. 22 -> 7)
  tzOffsetMin: number; // local timezone offset from UTC in minutes (JST = 540)
}

/** Local calendar date (YYYY-MM-DD) and hour for `nowMs` under the given tz offset. */
export function localParts(nowMs: number, tzOffsetMin: number): { date: string; hour: number } {
  const d = new Date(nowMs + tzOffsetMin * 60_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/**
 * Whether to send a digest now: at most once/day, at or after the digest hour, outside quiet hours
 * (docs/96 C-5). `nowMs` and `lastSentDate` are injected so this is a pure, testable decision.
 */
export function shouldSendDigest(
  nowMs: number,
  lastSentDate: string | null,
  p: DigestPolicy,
): boolean {
  if (!p.enabled) return false;
  const { date, hour } = localParts(nowMs, p.tzOffsetMin);
  if (lastSentDate === date) return false; // already handled today
  if (hour < p.hour) return false; // before the digest hour
  if (hour >= p.quietStartHour || hour < p.quietEndHour) return false; // quiet hours
  return true;
}

export interface DigestSchedulerDeps {
  source: DigestSource;
  notifier: Notifier;
  recipients: () => Promise<string[]>; // owner ids (allowlist)
  policy: DigestPolicy;
  statePath?: string;
  now?: () => number;
}

/**
 * Fires the morning digest. `tick()` is called periodically; it sends at most once/day and persists
 * the last-sent date (./data/state/digest.json) so a restart doesn't re-send. Honors the silence
 * principle (no digest when there's nothing to report) but still marks the day handled.
 */
export class DigestScheduler {
  private now: () => number;
  private statePath: string;
  constructor(private deps: DigestSchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.statePath = deps.statePath ?? `${process.env.STATE_DIR ?? "./data/state"}/digest.json`;
  }

  async tick(): Promise<void> {
    const nowMs = this.now();
    if (!shouldSendDigest(nowMs, await this.lastSent(), this.deps.policy)) return;
    const today = localParts(nowMs, this.deps.policy.tzOffsetMin).date;
    const due = await this.deps.source.commitmentsDueToday(today);
    const overdue = await this.deps.source.commitmentsOverdue(today, 2);
    await this.saveLastSent(today); // mark handled even if silent (don't recheck all day)
    const text = buildDigest(due, overdue);
    if (!text) return; // silence principle
    for (const userId of await this.deps.recipients()) {
      await this.deps.notifier
        .notify(userId, text)
        .catch((e) => console.error("digest notify:", (e as Error).message));
    }
  }

  private async lastSent(): Promise<string | null> {
    try {
      const j = JSON.parse(await readFile(this.statePath, "utf8")) as { lastSent?: string };
      return j.lastSent ?? null;
    } catch {
      return null;
    }
  }

  private async saveLastSent(date: string): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify({ lastSent: date }), "utf8");
  }
}
