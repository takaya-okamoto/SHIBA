/**
 * FTS_MATCH_WORD takes a CONSTANT string only (no placeholders), so the query must be inlined
 * as an escaped SQL string literal (docs/98 §6). Everything else uses bound `?` params.
 */
export function ftsLiteral(s: string): string {
  // drop ASCII control chars (code point < 0x20), cap length, escape single quotes
  const clean = [...s]
    .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)
    .join("")
    .slice(0, 200);
  return `'${clean.replace(/'/g, "''")}'`;
}

/**
 * LIKE fallback pattern for when FTS (preview) misbehaves (docs/91 §2.1/2.4-4). Bound as a `?` param
 * (unlike FTS_MATCH_WORD), so just escape the LIKE wildcards `%` `_` and cap length. CJK substring
 * match works fine here — it's a coarse keyword retreat, not a ranked route.
 */
export function likePattern(s: string): string {
  const clean = [...s]
    .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)
    .join("")
    .slice(0, 200)
    .replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${clean}%`;
}
