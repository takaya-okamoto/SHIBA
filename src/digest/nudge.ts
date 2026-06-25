import type { LlmClient } from "../llm/client.js";

/**
 * Proactive morning note for otherwise-quiet days: ONE genuinely useful thing the owner might have
 * missed (a heads-up, a prep reminder, a helpful connection from recent context). This replaces the
 * old nightly "insights", which leaked internal memory-maintenance notes (dedup/stale/confirm) to the
 * user. Best-effort and user-facing: returns "" when there's nothing worth saying.
 */
export const NUDGE_SYSTEM = `あなたはオーナーの相棒「シバ」。保存された事実をもとに、オーナーが見落としていそうで「知っておくと役立つ」ことを最大1つだけ、短い日本語で前向きに伝える。
- 役立つ実用情報だけ: 近づいている予定・準備しておくとよいこと・最近の文脈から気づく助けなど。
- 「記憶の重複/矛盾/整理/確認をおすすめ」などの内部メンテ的な指摘は絶対に書かない(ユーザーには無意味)。
- 確信が持てない、または役立つことが無ければ note は空文字。
- 1〜2文、シバの親しみやすい口調で。
出力は JSON のみ: {"note":"..."}。JSON以外は出力しない。`;

export function buildNudgeUser(facts: string[], today?: string): string {
  const anchor = today ? `今日 = ${today}\n\n` : "";
  return `${anchor}保存された事実(新しい順):\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
}

export function parseNudge(raw: unknown): string {
  const n = (raw as { note?: unknown } | null)?.note;
  return typeof n === "string" ? n.trim() : "";
}

/** Ask the model for one useful proactive note from recent facts ("" if none / on failure). */
export async function proactiveNudge(
  facts: string[],
  llm: LlmClient,
  today?: string,
): Promise<string> {
  if (facts.length === 0) return "";
  try {
    return parseNudge(await llm.json(NUDGE_SYSTEM, buildNudgeUser(facts, today)));
  } catch {
    return "";
  }
}
