// Measures the query shapes SHIBA recall depends on, especially the entity-route
// (JOIN fact_entities + vector + state filter) — the "10x" bet from docs/101.
// Prints p50/p95/p99 per shape, plus EXPLAIN ANALYZE for the entity-route to check
// whether the vector index applies AFTER the JOIN+filter (the pre/post-filter ANN question).
import { EMBED_MODEL, ftsLiteral, getConn, percentiles } from "./db.js";

const REPS = Number(process.env.BENCH_REPS ?? 30);
const QUERIES = [
  "田中さんとの打ち合わせ",
  "歯医者の予約はいつ",
  "引っ越しの見積もり",
  "B社との契約の話",
  "来週の予定",
  "健康診断について",
];
const rq = () => QUERIES[Math.floor(Math.random() * QUERIES.length)];

const c = await getConn();

const timed = async (fn: () => Promise<unknown>): Promise<number> => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

console.log("warming up (cluster cold start + plan cache) ...");
for (let i = 0; i < 5; i++) await c.query("SELECT 1");

const [hot] = await c.query(
  "SELECT entity_id, COUNT(*) c FROM fact_entities GROUP BY entity_id ORDER BY c DESC LIMIT 5",
);
const entityIds = (hot as Array<{ entity_id: number }>).map((r) => r.entity_id);
if (!entityIds.length) throw new Error("no data — run `pnpm seed` first");
const re = () => entityIds[Math.floor(Math.random() * entityIds.length)];

const shapes: Record<string, () => Promise<unknown>> = {
  "text-route: vector (auto-embed query)": () => {
    const q = rq();
    return c.query(
      `SELECT id, claim, VEC_EMBED_COSINE_DISTANCE(embedding, ?) d
         FROM facts WHERE state='active'
         ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?) LIMIT 20`,
      [q, q],
    );
  },
  "text-route: FTS (inlined literal)": () => {
    const lit = ftsLiteral(rq());
    return c.query(
      `SELECT id, claim FROM facts
         WHERE state='active' AND FTS_MATCH_WORD(${lit}, claim)
         ORDER BY FTS_MATCH_WORD(${lit}, claim) DESC LIMIT 20`,
    );
  },
  "entity-route: JOIN + vector (THE bet)": () => {
    const q = rq();
    return c.query(
      `SELECT f.id, f.claim, VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) d
         FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
         WHERE fe.entity_id = ? AND f.state='active'
         ORDER BY VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) LIMIT 20`,
      [q, re(), q],
    );
  },
  "entity-route: aggregate (all facts for X)": () => {
    return c.query(
      `SELECT f.id, f.claim FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
         WHERE fe.entity_id = ? AND f.state='active' LIMIT 40`,
      [re()],
    );
  },
  "1-hop neighbours of X": () => {
    return c.query(
      `SELECT DISTINCT f.id FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
         WHERE fe.entity_id IN (
           SELECT fe2.entity_id FROM fact_entities fe2
           WHERE fe2.fact_id IN (SELECT fact_id FROM fact_entities WHERE entity_id = ?)
         ) AND f.state='active' LIMIT 40`,
      [re()],
    );
  },
};

console.log(`\nbench — ${REPS} reps each, model=${EMBED_MODEL}\n`);
for (const [name, fn] of Object.entries(shapes)) {
  try {
    const ms: number[] = [];
    for (let i = 0; i < REPS; i++) ms.push(await timed(fn));
    const p = percentiles(ms);
    console.log(`${name}\n  p50=${p.p50}ms  p95=${p.p95}ms  p99=${p.p99}ms  (min=${p.min} max=${p.max}, n=${p.n})`);
  } catch (e) {
    console.log(`${name}\n  ERROR: ${(e as Error).message}`);
  }
}

console.log("\n--- EXPLAIN ANALYZE: entity-route + vector (look for vector index / TiFlash scan) ---");
try {
  const q = QUERIES[0];
  const [plan] = await c.query(
    `EXPLAIN ANALYZE SELECT f.id, VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) d
       FROM facts f JOIN fact_entities fe ON fe.fact_id = f.id
       WHERE fe.entity_id = ? AND f.state='active'
       ORDER BY VEC_EMBED_COSINE_DISTANCE(f.embedding, ?) LIMIT 20`,
    [q, entityIds[0], q],
  );
  for (const row of plan as Array<Record<string, unknown>>) console.log("  " + Object.values(row).join(" | "));
} catch (e) {
  console.log("  EXPLAIN failed: " + (e as Error).message);
}

await c.end();
console.log("\nRecord p50/p95 (esp. the entity-route bet) + RU consumption in ../../docs/LEARNINGS.md.");
