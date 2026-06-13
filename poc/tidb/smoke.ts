// Cheap syntax confirmation BEFORE the full schema/seed/bench.
// Confirms, on a tiny throwaway table, that the three TiDB features SHIBA depends on work:
//   (1) EMBED_TEXT auto-embed column   (2) vector query   (3) Japanese FTS.
// Each check is isolated so you see exactly which feature/syntax fails.
import { EMBED_DIM, EMBED_MODEL, getConn } from "./db.js";

const c = await getConn();
console.log(`smoke test — embed model = ${EMBED_MODEL} (dim ${EMBED_DIM})\n`);

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

await check("create table with EMBED_TEXT auto-embed column + vector index", async () => {
  await c.query("DROP TABLE IF EXISTS poc_smoke");
  await c.query(
    `CREATE TABLE poc_smoke (
       id BIGINT PRIMARY KEY AUTO_RANDOM,
       content VARCHAR(500) NOT NULL,
       embedding VECTOR(${EMBED_DIM}) GENERATED ALWAYS AS (EMBED_TEXT('${EMBED_MODEL}', content)) STORED,
       VECTOR INDEX idx_emb ((VEC_COSINE_DISTANCE(embedding)))
     )`,
  );
});

await check("insert rows -> embedding is generated (Gemini called by TiDB)", async () => {
  await c.query("INSERT INTO poc_smoke (content) VALUES (?), (?), (?)", [
    "田中さんとA社の打ち合わせは渋谷だった",
    "歯医者の予約は来週火曜の15時",
    "引っ越しの見積もりはB社が一番安かった",
  ]);
  const [rows] = await c.query("SELECT VEC_DIMS(embedding) AS dims FROM poc_smoke LIMIT 1");
  const dims = (rows as Array<{ dims: number | null }>)[0]?.dims;
  if (!dims) throw new Error("embedding not populated (auto-embed may be unwired for this model)");
  if (dims !== EMBED_DIM) throw new Error(`embedding dims = ${dims}, expected ${EMBED_DIM} (check EMBED_DIM vs model)`);
});

await check("vector query via auto-embedded query string (VEC_EMBED_COSINE_DISTANCE)", async () => {
  const q = "田中さんとの会議はどこ?";
  // distance expr must be byte-identical in SELECT and ORDER BY for the index to apply (mem9).
  await c.query(
    `SELECT id, content, VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS d
       FROM poc_smoke ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?) LIMIT 3`,
    [q, q],
  );
});

await check("Japanese full-text index (MULTILINGUAL parser)", async () => {
  await c.query("CREATE FULLTEXT INDEX idx_fts ON poc_smoke (content) WITH PARSER MULTILINGUAL");
});

await check("FTS_MATCH_WORD on a Japanese keyword", async () => {
  // FTS index build can be async; this asserts the syntax runs, not the hit count.
  await c.query("SELECT id FROM poc_smoke WHERE FTS_MATCH_WORD('歯医者', content) LIMIT 5");
});

await c.query("DROP TABLE IF EXISTS poc_smoke").catch(() => {});
await c.end();
console.log(`\n${failed === 0 ? "ALL PASS — safe to run `pnpm schema`." : `${failed} FAILED — fix syntax (record in LEARNINGS.md) before proceeding.`}`);
process.exit(failed === 0 ? 0 : 1);
