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
