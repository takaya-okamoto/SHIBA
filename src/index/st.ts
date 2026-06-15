/**
 * State-table access (docs/94 A-2, 96 C-3, 98 §9). `st_*` rows are runtime state, NOT derived from
 * Markdown, so they survive `reindex --all`. Every function is a thin TiDB call; callers fire-and-
 * forget (state writes must never delay or fail a turn). Only the query HASH is stored, never the
 * body (docs/98 §4.3).
 */
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";

export type MetricField = "turns" | "extraction_dropped" | "degraded_searches" | "recalls";

export function queryHash(q: string): string {
  return createHash("sha256").update(q).digest("hex");
}

/** Log a recall event (query hash + returned fact ids) — spaced-rep + eval input (95 B-1). */
export async function recordRecall(pool: Pool, query: string, factIds: string[]): Promise<void> {
  await pool.query("INSERT INTO st_recall_log (query_hash, fact_ids) VALUES (?, ?)", [
    queryHash(query),
    JSON.stringify(factIds),
  ]);
}

/** Count a security event (injection detected / secret scrubbed / allowlist denied / rate limited). */
export async function recordSecurityEvent(
  pool: Pool,
  kind: string,
  detail?: string,
): Promise<void> {
  await pool.query("INSERT INTO st_security_events (kind, detail) VALUES (?, ?)", [
    kind,
    detail ?? null,
  ]);
}

/** Webhook dedup: returns true if this update_id was already processed, else marks it (91 §1). */
export async function seenUpdate(pool: Pool, updateId: number): Promise<boolean> {
  const [res] = await pool.query("INSERT IGNORE INTO st_update_dedup (update_id) VALUES (?)", [
    updateId,
  ]);
  return (res as { affectedRows?: number }).affectedRows === 0; // 0 inserted = already existed
}

/** Purge dedup rows older than `olderThanHours` (default 48h). */
export async function purgeDedup(pool: Pool, olderThanHours = 48): Promise<void> {
  await pool.query(
    "DELETE FROM st_update_dedup WHERE created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)",
    [olderThanHours],
  );
}

/** Increment a daily metric counter (field is a fixed union — safe to template, never user input). */
export async function bumpMetric(
  pool: Pool,
  day: string,
  field: MetricField,
  by = 1,
): Promise<void> {
  await pool.query(
    `INSERT INTO st_metrics (day, ${field}) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ${field} = ${field} + VALUES(${field}), updated_at = CURRENT_TIMESTAMP`,
    [day, by],
  );
}

export interface MetricsRow {
  day: string;
  turns: number;
  extraction_dropped: number;
  degraded_searches: number;
  recalls: number;
}

/** Read a day's metrics row (for /status). */
export async function readMetrics(pool: Pool, day: string): Promise<MetricsRow | null> {
  const [rows] = await pool.query(
    "SELECT day, turns, extraction_dropped, degraded_searches, recalls FROM st_metrics WHERE day = ?",
    [day],
  );
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    day: String(r.day),
    turns: Number(r.turns),
    extraction_dropped: Number(r.extraction_dropped),
    degraded_searches: Number(r.degraded_searches),
    recalls: Number(r.recalls),
  };
}
