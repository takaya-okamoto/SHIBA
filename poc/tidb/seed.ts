// Seeds realistic Japanese facts + entities + fact_entities with explicit ids.
// Each fact INSERT triggers a Gemini embed (auto-embed), so total time ≈ embed throughput
// and the run is itself a cost/RU data point. Configure size with FACTS (default 2000).
import { getConn } from "./db.js";

const N = Number(process.env.FACTS ?? 2000);

const people = ["田中", "佐藤", "鈴木", "高橋", "渡辺", "伊藤", "山本", "中村", "小林", "加藤", "吉田", "山田"];
const orgs = ["あおぞら商事", "みらいテック", "さくら銀行", "ひので物産", "つきのわ製作所", "A社", "B社", "C社"];
const places = ["渋谷", "新宿", "品川", "横浜", "大阪", "名古屋", "オンライン", "本社会議室"];
const topics = ["歯医者", "引っ越し", "定例会議", "契約更新", "健康診断", "出張", "ランチ", "プロジェクトX"];

type Ent = { id: number; slug: string; name: string; kind: string };
const entities: Ent[] = [];
let eid = 1;
for (const [kind, names] of [["person", people], ["org", orgs], ["place", places], ["topic", topics]] as const) {
  names.forEach((name, i) => entities.push({ id: eid++, slug: `${kind}-${i}`, name, kind }));
}
const idBySlug = new Map(entities.map((e) => [e.slug, e.id]));

const rand = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const ent = (kind: string) => rand(entities.filter((e) => e.kind === kind));

type Gen = { claim: string; slugs: string[] };
const templates: Array<() => Gen> = [
  () => { const p = ent("person"), o = ent("org"), pl = ent("place"); return { claim: `${p.name}さんと${o.name}の打ち合わせが${pl.name}であった`, slugs: [p.slug, o.slug, pl.slug] }; },
  () => { const p = ent("person"), t = ent("topic"); return { claim: `${p.name}さんの${t.name}は来週に予定されている`, slugs: [p.slug, t.slug] }; },
  () => { const o = ent("org"), t = ent("topic"), p = ent("person"); return { claim: `${o.name}との${t.name}について${p.name}さんと話した`, slugs: [o.slug, t.slug, p.slug] }; },
  () => { const t = ent("topic"), o = ent("org"); return { claim: `${t.name}の件は${o.name}に依頼することにした`, slugs: [t.slug, o.slug] }; },
  () => { const p = ent("person"), pl = ent("place"); return { claim: `${p.name}さんとは${pl.name}でランチをした`, slugs: [p.slug, pl.slug] }; },
];

const c = await getConn();

console.log(`inserting ${entities.length} entities ...`);
await c.query(
  "INSERT INTO entities (id, slug, name, kind) VALUES " + entities.map(() => "(?,?,?,?)").join(",") +
    " ON DUPLICATE KEY UPDATE name=VALUES(name)",
  entities.flatMap((e) => [e.id, e.slug, e.name, e.kind]),
);

console.log(`inserting ${N} facts (each triggers a Gemini embed) ...`);
const start = performance.now();
for (let i = 0; i < N; i++) {
  const factId = i + 1;
  const g = rand(templates)();
  const state = Math.random() < 0.1 ? "superseded" : "active";
  const trust = Math.random() < 0.1 ? "untrusted" : "owner";
  await c.query("INSERT INTO facts (id, claim, kind, state, source_trust) VALUES (?,?,?,?,?)", [
    factId, g.claim, "fact", state, trust,
  ]);
  const uniq = [...new Set(g.slugs)];
  await c.query(
    "INSERT IGNORE INTO fact_entities (fact_id, entity_id) VALUES " + uniq.map(() => "(?,?)").join(","),
    uniq.flatMap((s) => [factId, idBySlug.get(s)]),
  );
  if ((i + 1) % 200 === 0) {
    const rate = (i + 1) / ((performance.now() - start) / 1000);
    console.log(`  ${i + 1}/${N}  (${rate.toFixed(1)} facts/s)`);
  }
}
const secs = (performance.now() - start) / 1000;
await c.end();
console.log(`done: ${N} facts in ${secs.toFixed(1)}s (${(N / secs).toFixed(1)}/s). Record embed cost/RU in LEARNINGS.md.`);
