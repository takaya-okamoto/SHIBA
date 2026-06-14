import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type DigestSource, buildDigest } from "./digest.js";

export interface Notifier {
  notify(userId: string, text: string): Promise<void>;
}

export interface DigestPolicy {
  enabled: boolean;
  hour: number;
  quietStartHour: number;
  quietEndHour: number;
  tzOffsetMin: number;
}

export function localParts(nowMs: number, tzOffsetMin: number): { date: string; hour: number } {
  const d = new Date(nowMs + tzOffsetMin * 60_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/** Once-a-day gate: not run yet today, and at/after the given local hour. Shared by digest + dream. */
export function shouldRunDaily(
  nowMs: number,
  lastRunDate: string | null,
  hour: number,
  tzOffsetMin: number,
): boolean {
  const { date, hour: h } = localParts(nowMs, tzOffsetMin);
  return lastRunDate !== date && h >= hour;
}

/** At most once/day, at/after the digest hour, outside quiet hours (docs/96 C-5). Pure + testable. */
export function shouldSendDigest(
  nowMs: number,
  lastSentDate: string | null,
  p: DigestPolicy,
): boolean {
  if (!p.enabled) return false;
  if (!shouldRunDaily(nowMs, lastSentDate, p.hour, p.tzOffsetMin)) return false;
  const { hour } = localParts(nowMs, p.tzOffsetMin);
  return !(hour >= p.quietStartHour || hour < p.quietEndHour);
}

export interface DigestSchedulerDeps {
  source: DigestSource;
  notifier: Notifier;
  recipients: () => Promise<string[]>;
  policy: DigestPolicy;
  /** Optional nightly-dream insights for `today` (appended to the digest). */
  insights?: (today: string) => Promise<string[]>;
  statePath?: string;
  now?: () => number;
}

/**
 * Fires the morning digest. tick() sends at most once/day, persists the last-sent date so a restart
 * doesn't re-send, and honors the silence principle (no digest when there's nothing to report).
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
    const insights = this.deps.insights ? await this.deps.insights(today) : [];
    await this.saveLastSent(today);
    const text = buildDigest(due, overdue, insights);
    if (!text) return;
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
