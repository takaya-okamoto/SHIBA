import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../index/db.js";

/** Data the morning digest needs. Injectable so the formatter is unit-testable without TiDB. */
export interface DigestSource {
  /** Events/commitments scheduled for today (valid_from = today). */
  scheduleDueToday(today: string): Promise<string[]>;
  /** Events/commitments coming up within `days` (valid_from in (today, today+days]), soonest first. */
  scheduleUpcoming(today: string, days: number, limit: number): Promise<UpcomingItem[]>;
  /** Active commitments whose valid_from is already past (oldest first), capped at `limit`. */
  commitmentsOverdue(today: string, limit: number): Promise<string[]>;
  /** Most-recent active claims — context for the proactive "things you might've missed" note. */
  recentFacts(limit: number): Promise<string[]>;
}

export interface UpcomingItem {
  claim: string;
  date: string; // YYYY-MM-DD (valid_from)
}

interface ClaimRow extends RowDataPacket {
  claim: string;
}
interface UpcomingRow extends RowDataPacket {
  claim: string;
  valid_from: string;
}

/** TiDB-backed digest source. Reads `facts` (events + commitments). */
export class TidbDigestSource implements DigestSource {
  private pool: Pool;
  constructor() {
    this.pool = getPool();
  }

  async scheduleDueToday(today: string): Promise<string[]> {
    const [rows] = await this.pool.query<ClaimRow[]>(
      `SELECT claim FROM facts
         WHERE kind IN ('event','commitment') AND state = 'active' AND valid_from = ?
         ORDER BY recorded_at DESC LIMIT 10`,
      [today],
    );
    return rows.map((r) => r.claim);
  }

  async scheduleUpcoming(today: string, days: number, limit: number): Promise<UpcomingItem[]> {
    const [rows] = await this.pool.query<UpcomingRow[]>(
      `SELECT claim, DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from FROM facts
         WHERE kind IN ('event','commitment') AND state = 'active'
           AND valid_from > ? AND valid_from <= DATE_ADD(?, INTERVAL ? DAY)
         ORDER BY valid_from ASC LIMIT ?`,
      [today, today, days, limit],
    );
    return rows.map((r) => ({ claim: r.claim, date: r.valid_from }));
  }

  async commitmentsOverdue(today: string, limit: number): Promise<string[]> {
    const [rows] = await this.pool.query<ClaimRow[]>(
      `SELECT claim FROM facts
         WHERE kind = 'commitment' AND state = 'active' AND valid_from < ?
         ORDER BY valid_from ASC LIMIT ?`,
      [today, limit],
    );
    return rows.map((r) => r.claim);
  }

  async recentFacts(limit: number): Promise<string[]> {
    const [rows] = await this.pool.query<ClaimRow[]>(
      `SELECT claim FROM facts WHERE state = 'active' ORDER BY recorded_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => r.claim);
  }
}

export interface DigestInput {
  /** Pre-formatted weather line (incl. location label), or null/absent when no location is set. */
  weather?: string | null;
  dueToday?: string[];
  upcoming?: UpcomingItem[];
  overdue?: string[];
  /** Proactive "you might've missed this" note (user-facing, NOT internal memory maintenance). */
  nudge?: string;
  /** Local today (YYYY-MM-DD) — anchors the "in N days" countdown for upcoming items. */
  today?: string;
}

/** "2026-07-01" -> "7月1日". */
function jpDate(d: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${Number(m[1])}月${Number(m[2])}日`;
}

/** Whole days from `today` to `date` (both YYYY-MM-DD, parsed as UTC midnight). */
function daysAway(today: string, date: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Format the morning digest. Useful content only — greeting + weather + today's schedule + a heads-up
 * for what's coming + a proactive note for otherwise-quiet days. Returns null only when there is truly
 * nothing worth sending (e.g. no weather configured and nothing on the calendar). Internal
 * memory-maintenance "insights" are deliberately NOT shown here.
 */
export function buildDigest(input: DigestInput): string | null {
  const { weather, dueToday = [], upcoming = [], overdue = [], nudge = "", today = "" } = input;
  const parts: string[] = [];
  if (weather) parts.push(`🌤 今日の天気\n${weather}`);
  if (dueToday.length > 0) {
    parts.push(`📅 今日の予定\n${dueToday.map((c) => `・${c}`).join("\n")}`);
  }
  if (upcoming.length > 0) {
    parts.push(
      `🔜 このあとの予定\n${upcoming
        .map((u) => {
          const n = today ? daysAway(today, u.date) : 0;
          const when = n > 0 ? `(あと${n}日)` : "";
          // Skip the date prefix when the claim already states the date (avoids "7月1日 7月1日…").
          const label = jpDate(u.date);
          const prefix = u.claim.includes(label) ? "" : `${label} `;
          return `・${prefix}${u.claim}${when}`;
        })
        .join("\n")}`,
    );
  }
  if (overdue.length > 0) {
    parts.push(`📝 気になっている約束\n${overdue.map((c) => `・${c}`).join("\n")}`);
  }
  if (nudge) parts.push(`🐕 ${nudge}`);
  if (parts.length === 0) return null;
  return `おはようございます。\n\n${parts.join("\n\n")}`;
}
