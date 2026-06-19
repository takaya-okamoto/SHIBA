import type { LlmClient } from "../llm/client.js";
import { scrubSecrets } from "../security/redact.js";
import { sanitizeText, stripInjectedContext } from "../security/sanitize.js";

/**
 * Episodic layer (complements the atomic facts fence): a short prose "note" of a conversation so the
 * narrative context survives, not just the distilled facts. Written to the daily note as prose, where
 * reindex chunks it into the chunk/text recall route (docs/90 §2). Atomic facts answer "what is true";
 * this answers "what did we talk about, and why". Same input hardening as extraction (docs/98 §2-4).
 */
export const SUMMARY_SYSTEM = `あなたは会話を後から思い出すための短い「会話メモ」を書く。
- 1〜3文の日本語の散文。誰と・何を・どういう経緯や結論で話したかが、文脈なしに読んでも分かるように要約する。
- 事実の箇条書きではなく、流れの分かる地の文。固有名・日付・数値は保つ。
- 推測で補わない。会話に無いことは書かない。要約に値する中身が無ければ summary は空文字。
出力は JSON のみ: {"summary":"..."}。JSON以外は出力しない。`;

/** Wrap the transcript as untrusted data (docs/98 §2); the observation date is the trusted anchor. */
export function buildSummaryUser(turnText: string, observationDate?: string): string {
  const anchor = observationDate ? `観測日(この会話があった日)= ${observationDate}\n\n` : "";
  return `${anchor}<untrusted_input>\n${turnText}\n</untrusted_input>`;
}

/** Tolerant parse of {summary:"..."} — sanitize+scrub the output too (it is stored + re-injected). */
export function parseSummary(raw: unknown, scrubPii = true): string {
  const s = (raw as { summary?: unknown } | null)?.summary;
  if (typeof s !== "string") return "";
  return scrubSecrets(sanitizeText(s.trim()), { pii: scrubPii });
}

export interface SummarizeOptions {
  observationDate?: string;
  scrubPii?: boolean;
}

/** Produce a one-paragraph episodic summary of the transcript (empty string on nothing / failure). */
export async function summarizeTranscript(
  turnText: string,
  llm: LlmClient,
  opts: SummarizeOptions = {},
): Promise<string> {
  const scrubPii = opts.scrubPii ?? true;
  const scrubbed = scrubSecrets(sanitizeText(stripInjectedContext(turnText)), { pii: scrubPii });
  let raw: unknown;
  try {
    raw = await llm.json(SUMMARY_SYSTEM, buildSummaryUser(scrubbed, opts.observationDate));
  } catch {
    return ""; // summary is best-effort — never fail a flush over it
  }
  return parseSummary(raw, scrubPii);
}
