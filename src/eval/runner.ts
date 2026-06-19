// Eval runner: load fixture suites, run each case through the real `search()`, assert the result.
// Pure-offline (no TiDB) — the providers stand in for the DB and the runner always pins entityIds
// so search() never calls resolveEntities (which would hit the pool).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { search } from "../search/index.js";
import type { SearchOptions } from "../types.js";
import { CorpusProvider, routeProvider } from "./providers.js";
import type { CaseResult, EvalCase, Suite } from "./types.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function hasAssertion(c: EvalCase): boolean {
  return (
    c.topK !== undefined ||
    c.first !== undefined ||
    c.contains !== undefined ||
    c.excludes !== undefined ||
    c.order !== undefined ||
    c.count !== undefined
  );
}

/** Parse + light-validate a suite YAML. Throws with a clear message so a malformed fixture is loud. */
export function parseSuite(yamlText: string, label = "<inline>"): Suite {
  const raw = parse(yamlText) as Partial<Suite> | null;
  if (!raw || typeof raw !== "object") throw new Error(`${label}: not a YAML mapping`);
  if (!raw.suite) throw new Error(`${label}: missing "suite" name`);
  const mode = raw.mode ?? "routes";
  if (mode !== "routes" && mode !== "corpus") throw new Error(`${label}: bad mode "${mode}"`);
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error(`${label}: no cases`);
  if (mode === "corpus" && !raw.corpus) throw new Error(`${label}: corpus mode needs "corpus"`);
  for (const c of raw.cases) {
    if (!c.name) throw new Error(`${label}: a case is missing "name"`);
    if (!c.query) throw new Error(`${label}/${c.name}: missing "query"`);
    if (!hasAssertion(c)) {
      throw new Error(
        `${label}/${c.name}: no expectation (topK/first/contains/excludes/order/count)`,
      );
    }
  }
  return { suite: raw.suite, mode, corpus: raw.corpus, cases: raw.cases };
}

function eqArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Run all assertions on a case, collecting human-readable failures (empty array = pass). */
export function assertCase(c: EvalCase, got: string[]): string[] {
  const f: string[] = [];
  if (c.topK && !eqArray(got, c.topK)) f.push(`topK expected [${c.topK}]`);
  if (c.first !== undefined && got[0] !== c.first) {
    f.push(`first expected ${c.first}, got ${got[0] ?? "(none)"}`);
  }
  for (const id of c.contains ?? []) if (!got.includes(id)) f.push(`missing ${id}`);
  for (const id of c.excludes ?? []) if (got.includes(id)) f.push(`should exclude ${id}`);
  if (c.order) {
    for (let i = 0; i + 1 < c.order.length; i++) {
      const a = got.indexOf(c.order[i] as string);
      const b = got.indexOf(c.order[i + 1] as string);
      if (a === -1) f.push(`order: ${c.order[i]} not in result`);
      else if (b === -1) f.push(`order: ${c.order[i + 1]} not in result`);
      else if (a >= b) f.push(`order: expected ${c.order[i]} before ${c.order[i + 1]}`);
    }
  }
  if (c.count?.min !== undefined && got.length < c.count.min) {
    f.push(`count ${got.length} < min ${c.count.min}`);
  }
  if (c.count?.max !== undefined && got.length > c.count.max) {
    f.push(`count ${got.length} > max ${c.count.max}`);
  }
  return f;
}

/** Run one case through the real search() with an offline provider. */
export async function runCase(suite: Suite, c: EvalCase): Promise<CaseResult> {
  const provider =
    suite.mode === "corpus"
      ? new CorpusProvider(suite.corpus ?? {})
      : routeProvider(c.routes ?? {});
  const opts: SearchOptions = {
    entityIds: c.entityIds ?? [], // always set -> search() never resolves entities against the DB
    now: c.now ? Date.parse(c.now) : undefined,
  };
  const hits = await search(c.query, opts, provider);
  const got = hits.map((h) => h.id);
  const failures = assertCase(c, got);
  return { suite: suite.suite, name: c.name, passed: failures.length === 0, failures, got };
}

export async function runSuite(suite: Suite): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of suite.cases) out.push(await runCase(suite, c));
  return out;
}

/** Discover `*.yaml` suites in a fixtures dir (sorted for stable ordering). */
export function loadFixtureSuites(dir = FIXTURE_DIR): Suite[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => parseSuite(readFileSync(join(dir, f), "utf8"), f));
}

export async function runAllFixtures(dir = FIXTURE_DIR): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const s of loadFixtureSuites(dir)) results.push(...(await runSuite(s)));
  return results;
}

/** Render a CLI report; one line per case, indented detail on failures. */
export function formatReport(results: CaseResult[]): string {
  const lines: string[] = [];
  let pass = 0;
  for (const r of results) {
    if (r.passed) {
      pass++;
      lines.push(`✓ ${r.suite}/${r.name}`);
    } else {
      lines.push(`✗ ${r.suite}/${r.name}`);
      for (const why of r.failures) lines.push(`    ${why}`);
      lines.push(`    got=[${r.got.join(", ")}]`);
    }
  }
  lines.push("");
  lines.push(`${pass}/${results.length} passed`);
  return lines.join("\n");
}
