/**
 * Unicode hygiene before extraction / memory storage (docs/98 §2.3).
 *
 * One pass over code points: drop invisible / abusable formatting chars, normalize angle-bracket
 * homoglyphs (so a forged `<untrusted_input>` delimiter can't slip past the real one), and keep
 * everything else — including ZWJ (U+200D) so emoji sequences like 👨‍👩‍👧 survive (Telegram is
 * emoji-heavy). Iterating code points (like search/fts.ts) avoids control-char regexes.
 */

// Invisible formatting to remove. ZWJ (U+200D) is deliberately NOT here (preserve emoji sequences).
const DROP = new Set<number>([
  0x200b, // zero-width space
  0x200c, // zero-width non-joiner
  0x2060, // word joiner
  0xfeff, // BOM / zero-width no-break space
  0x180e, // Mongolian vowel separator
  // bidi overrides (U+202A–202E) + directional isolates (U+2066–2069): hide / visually reorder text
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
]);

// Angle-bracket homoglyphs → ASCII `<` / `>` (defeat fake-delimiter injection).
const MAP = new Map<number, string>([
  [0xff1c, "<"], // ＜ fullwidth
  [0x3008, "<"], // 〈 CJK angle
  [0x2329, "<"], // 〈 left-pointing angle
  [0x276e, "<"], // ❮ heavy angle
  [0x27e8, "<"], // ⟨ mathematical angle
  [0xff1e, ">"], // ＞ fullwidth
  [0x3009, ">"], // 〉 CJK angle
  [0x232a, ">"], // 〉 right-pointing angle
  [0x276f, ">"], // ❯ heavy angle
  [0x27e9, ">"], // ⟩ mathematical angle
]);

/** C0 controls (except \t \n \r), DEL, and C1 controls. */
function isControl(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false;
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
}

export function sanitizeText(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (DROP.has(cp) || isControl(cp)) continue;
    out += MAP.get(cp) ?? ch;
  }
  return out;
}

/**
 * Strip previously-injected memory blocks from extraction input (docs/98 §3.1; mem9
 * `stripInjectedContext`). Defensive: the session records raw owner text, so nothing generated
 * should reach the extractor — this guarantees recall / dream output can never re-enter the
 * extractor and start a self-contamination loop, even if a caller later records augmented text.
 */
const INJECTED_BLOCK = /<(relevant-memories|untrusted_memory|untrusted_input)>[\s\S]*?<\/\1>/gi;

export function stripInjectedContext(input: string): string {
  return input.replace(INJECTED_BLOCK, "").trim();
}
