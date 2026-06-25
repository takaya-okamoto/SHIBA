import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LlmClient } from "../llm/client.js";
import { type DigestSource, buildDigest } from "./digest.js";
import { proactiveNudge } from "./nudge.js";
import { type WeatherLocation, fetchWeatherLine } from "./weather.js";

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
  /** Weather location (Open-Meteo). Omit to skip weather until the owner's location is configured. */
  weather?: WeatherLocation;
  /** LLM for the proactive "you might've missed this" note on otherwise-quiet days. */
  llm?: LlmClient;
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
    const src = this.deps.source;
    const dueToday = await src.scheduleDueToday(today);
    const upcoming = await src.scheduleUpcoming(today, 7, 5);
    const overdue = await src.commitmentsOverdue(today, 2);
    const weather = this.deps.weather ? await fetchWeatherLine(this.deps.weather) : null;
    // Proactive note only when the calendar is quiet — so it adds value, not noise.
    let nudge = "";
    if (dueToday.length === 0 && upcoming.length === 0 && this.deps.llm) {
      nudge = await proactiveNudge(await src.recentFacts(40), this.deps.llm, today);
    }
    await this.saveLastSent(today);
    const text = buildDigest({ today, weather, dueToday, upcoming, overdue, nudge });
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
