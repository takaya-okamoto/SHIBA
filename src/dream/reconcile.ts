import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../index/db.js";
import type { LlmClient } from "../llm/client.js";

/** Active facts the nightly reconcile reviews. Injectable so the logic is testable without TiDB. */
export interface ReconcileSource {
  activeFacts(limit: number): Promise<{ claim: string; kind: string; recordedAt: string }[]>;
}

interface FactRow extends RowDataPacket {
  claim: string;
  kind: string;
  recorded_at: Date | string | null;
}

export class TidbReconcileSource implements ReconcileSource {
  private pool: Pool;
  constructor() {
    this.pool = getPool();
  }
  async activeFacts(limit: number): Promise<{ claim: string; kind: string; recordedAt: string }[]> {
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT claim, kind, recorded_at FROM facts
         WHERE state = 'active' ORDER BY recorded_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({
      claim: r.claim,
      kind: r.kind,
      recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : "",
    }));
  }
}

const RECONCILE_SYSTEM =
  "あなたはユーザーの記憶を整理するアシスタント。以下はユーザーについて保存された事実の一覧。" +
  "矛盾している・重複している・古くなった可能性があるものを見つけ、短い「気づき」を日本語で最大3件挙げよ。" +
  "確信が持てないものは挙げない。事実を勝手に消したり書き換えたりはせず、あくまで気づきの指摘に留める。" +
  '整理すべきものが無ければ空配列を返す。出力はJSONのみ: {"insights": ["..."]}';

export function buildReconcilePrompt(
  facts: { claim: string; kind: string; recordedAt: string }[],
): string {
  return facts
    .map((f, i) => `${i + 1}. [${f.kind}] ${f.claim}（${f.recordedAt.slice(0, 10)}）`)
    .join("\n");
}

/** Tolerant parse of the model's {insights:[...]} (caps at 3, drops non-strings/empties). */
export function parseInsights(raw: unknown): string[] {
  if (raw && typeof raw === "object" && "insights" in raw) {
    const arr = (raw as { insights: unknown }).insights;
    if (Array.isArray(arr)) {
      return arr.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 3);
    }
  }
  return [];
}

/** Review active facts for contradictions/duplicates; returns short insights (empty if nothing). */
export async function reconcile(
  source: ReconcileSource,
  llm: LlmClient,
  limit = 50,
): Promise<string[]> {
  const facts = await source.activeFacts(limit);
  if (facts.length < 2) return []; // nothing to reconcile
  const raw = await llm.json(RECONCILE_SYSTEM, buildReconcilePrompt(facts));
  return parseInsights(raw);
}
