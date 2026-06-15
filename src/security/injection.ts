/**
 * Prompt-injection pattern detection (docs/98 §2.2) — single source of truth, EN + JA.
 *
 * Detection != block (openclaw / hermes): callers LOG + COUNT and otherwise rely on the structural
 * `<untrusted_input>` delimiter; only an explicit write (e.g. `/remember`) should ever hard-block,
 * so a false positive never breaks normal conversation. Existing repos ship EN-only patterns — we
 * add Japanese paraphrases since SHIBA runs in Japanese.
 */

export interface InjectionMatch {
  detected: boolean;
  /** Names of the rules that fired (for logs / counters). */
  patterns: string[];
}

const RULES: { name: string; re: RegExp }[] = [
  {
    // classic "ignore/disregard the previous instructions", with filler-word bypass guard
    name: "ignore-previous",
    re: /\b(?:ignore|disregard|forget)\b(?:\s+\w+){0,4}\s+\b(?:previous|above|prior|earlier|all|these|those|the)\b(?:\s+\w+){0,3}\s+\b(?:instructions?|prompts?|rules?|messages?|context)\b/i,
  },
  {
    name: "persona-override",
    re: /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|developer\s+mode|jailbreak|\bDAN\b)\b/i,
  },
  {
    name: "system-prompt-probe",
    re: /\b(?:system\s+prompt|reveal\s+your\s+(?:instructions?|prompt|rules?)|print\s+your\s+(?:instructions?|prompt))\b/i,
  },
  {
    // closing-tag / delimiter injection against our structural fences
    name: "delimiter-injection",
    re: /<\/?(?:untrusted_input|untrusted_memory|relevant-memories|system|assistant|user)\b[^>]*>/i,
  },
  {
    // exfil — low priority (we run no tools) but worth flagging
    name: "exfil",
    re: /\b(?:curl|wget|cat)\b[^\n]*\.env\b/i,
  },
  {
    name: "ja-ignore-instructions",
    re: /(?:上記|これまで|以前|今まで|先ほど|前)の?(?:指示|命令|ルール|プロンプト|文脈)[^。\n]{0,12}(?:無視|忘れ|破棄|従わ)/,
  },
  {
    name: "ja-new-instructions",
    re: /(?:新しい|本当の|次の)(?:指示|命令|ルール)(?:に従|を実行|はこ|は次)/,
  },
  {
    name: "ja-reveal",
    re: /(?:システム)?(?:プロンプト|指示|命令)を(?:表示|教え|出力|見せ)/,
  },
];

export function detectInjection(text: string): InjectionMatch {
  const patterns: string[] = [];
  for (const { name, re } of RULES) if (re.test(text)) patterns.push(name);
  return { detected: patterns.length > 0, patterns };
}
