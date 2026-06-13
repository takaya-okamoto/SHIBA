// Applies schema.sql, injecting EMBED_MODEL. Run after `pnpm smoke` passes.
import { readFileSync } from "node:fs";
import { EMBED_DIM, EMBED_MODEL, getConn } from "./db.js";

const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8")
  .replaceAll("__EMBED_MODEL__", EMBED_MODEL)
  .replaceAll("__EMBED_DIM__", String(EMBED_DIM));

const c = await getConn();
console.log(`Applying schema (embed model = ${EMBED_MODEL}, dim = ${EMBED_DIM}) ...`);
// Strip whole-line comments FIRST (so a statement preceded by a comment isn't dropped),
// then split on ; and run sequentially so a failure points to the exact statement.
const stmts = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
for (const stmt of stmts) {
  const head = stmt.replace(/\s+/g, " ").slice(0, 70);
  try {
    await c.query(stmt);
    console.log(`  ok  ${head}`);
  } catch (e) {
    console.error(`  ERR ${head}\n      ${(e as Error).message}`);
    throw e;
  }
}
await c.end();
console.log("schema applied.");
