// Compares EXPLAIN ANALYZE for entity-route variants to find a scale-safe form
// that drives from fact_entities(entity_id) instead of full-scanning facts.
import { getConn } from "./db.js";

const c = await getConn();
const [hot] = await c.query(
  "SELECT entity_id, COUNT(*) c FROM fact_entities GROUP BY entity_id ORDER BY c DESC LIMIT 1",
);
const e = (hot as Array<{ entity_id: number }>)[0].entity_id;
const q = "田中さんとの打ち合わせ";

const variants: Record<string, [string, unknown[]]> = {
  "A. original JOIN (baseline)": [
    `EXPLAIN ANALYZE SELECT f.id, VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) d
       FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
       WHERE fe.entity_id = ? AND f.state='active'
       ORDER BY VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) LIMIT 20`,
    [q, e, q],
  ],
  "B. IN-subquery rewrite": [
    `EXPLAIN ANALYZE SELECT f.id, VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) d
       FROM facts f
       WHERE f.id IN (SELECT fact_id FROM fact_entities WHERE entity_id = ?) AND f.state='active'
       ORDER BY VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) LIMIT 20`,
    [q, e, q],
  ],
  "C. JOIN + /*+ LEADING(fe, f) */ hint": [
    `EXPLAIN ANALYZE SELECT /*+ LEADING(fe, f) */ f.id, VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) d
       FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
       WHERE fe.entity_id = ? AND f.state='active'
       ORDER BY VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) LIMIT 20`,
    [q, e, q],
  ],
};

console.log(`hot entity_id = ${e}\n`);
for (const [name, [sql, params]] of Object.entries(variants)) {
  console.log(`===== ${name} =====`);
  try {
    const [plan] = await c.query(sql, params);
    for (const row of plan as Array<Record<string, unknown>>) {
      const v = Object.values(row);
      // columns: id | estRows | actRows | task | access | execInfo | operatorInfo | mem | disk
      console.log(`${v[0]} | est:${v[1]} act:${v[2]} | ${v[3]} | ${String(v[4] ?? "")} | ${String(v[6] ?? "").slice(0, 90)}`);
    }
  } catch (err) {
    console.log("ERROR:", (err as Error).message);
  }
  console.log();
}
await c.end();
