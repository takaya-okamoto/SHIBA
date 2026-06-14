import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../index/db.js";

/** Data the morning digest needs. Injectable so the formatter is unit-testable without TiDB. */
export interface DigestSource {
  /** Active commitments whose valid_from is today. */
  commitmentsDueToday(today: string): Promise<string[]>;
  /** Active commitments whose valid_from is in the past (oldest first), capped at `limit`. */
  commitmentsOverdue(today: string, limit: number): Promise<string[]>;
}

interface ClaimRow extends RowDataPacket {
  claim: string;
}

/** TiDB-backed digest source. Reads `facts` (kind=commitment, state=active). */
export class TidbDigestSource implements DigestSource {
  private pool: Pool;
  constructor() {
    this.pool = getPool();
  }

  async commitmentsDueToday(today: string): Promise<string[]> {
    const [rows] = await this.pool.query<ClaimRow[]>(
      `SELECT claim FROM facts
         WHERE kind = 'commitment' AND state = 'active' AND valid_from = ?
         ORDER BY recorded_at DESC LIMIT 10`,
      [today],
    );
    return rows.map((r) => r.claim);
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
}

/**
 * Format the morning digest. Returns null when there's nothing to report — the "silence principle"
 * (docs/96 C-5): don't send an empty digest. Dreaming results can be appended here later.
 */
export function buildDigest(dueToday: string[], overdue: string[]): string | null {
  const parts: string[] = [];
  if (dueToday.length > 0) {
    parts.push(`今日の予定・約束:\n${dueToday.map((c) => `・${c}`).join("\n")}`);
  }
  if (overdue.length > 0) {
    parts.push(`気になっている約束:\n${overdue.map((c) => `・${c}`).join("\n")}`);
  }
  if (parts.length === 0) return null;
  return `おはようございます。\n\n${parts.join("\n\n")}`;
}
