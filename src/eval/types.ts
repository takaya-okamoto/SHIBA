// Search-regression eval harness — fixture schema + result types (docs/95 B-1, layer 1).
//
// Two fixture modes, both feeding the REAL `search()` orchestration so we regress our own fusion
// (RRF / demote / recency / autocut), the exact place openclaw's "BM25-only hit dropped" math bug
// lived:
//   - "routes"  : a case pre-specifies each route's raw output -> tests fusion math precisely.
//   - "corpus"  : a shared in-memory corpus + faithful LIKE substring -> tests the keyword/LIKE
//                 fallback recall (incl. Japanese substrings) that the doc says CI MUST cover.
// Vector/FTS *engine* fidelity (TiDB collation, embedding cosine) is out of scope here and is left
// to the nightly DB-backed run (see fixtures/README.md).

import type { FactKind, SourceTrust } from "../types.js";

/** A single route's raw output in a routes-mode fixture — mirrors search/provider.RouteHit. */
export interface HitSpec {
  id: string;
  claim: string;
  trust?: SourceTrust; // default "owner"
  kind?: FactKind; // dated kinds (event/commitment) decay; omit for pure-fusion cases
  recordedAt?: string; // ISO; for recency decay
  distance?: number; // vector/entity cosine (lower = closer)
}

/** The five routes a case can pre-populate (routes mode). */
export interface CaseRoutes {
  vector?: HitSpec[];
  fts?: HitSpec[];
  chunkVector?: HitSpec[];
  chunkFts?: HitSpec[];
  entity?: HitSpec[];
}

export interface CorpusFactSpec {
  id: string;
  claim: string;
  kind?: FactKind;
  trust?: SourceTrust;
  recordedAt?: string;
  entities?: string[]; // entity ids this fact links to (drives corpus-mode entityRoute)
}

export interface CorpusChunkSpec {
  id: string;
  content: string;
  trust?: SourceTrust;
}

export interface Corpus {
  facts?: CorpusFactSpec[];
  chunks?: CorpusChunkSpec[];
}

/** Assertions on a case's final result ids (after autocut). Any subset may be set; all must hold. */
export interface Expectations {
  /** Exact ordered final ids. */
  topK?: string[];
  /** result[0].id. */
  first?: string;
  /** All must be present (order-free). */
  contains?: string[];
  /** None may be present. */
  excludes?: string[];
  /** Each listed id must rank strictly above the next (subsequence order). */
  order?: string[];
  /** Result-count bounds. */
  count?: { min?: number; max?: number };
}

export interface EvalCase extends Expectations {
  name: string;
  why?: string; // human rationale (shown in docs / report)
  query: string;
  now?: string; // ISO; pins recency time so dated cases are deterministic
  entityIds?: string[]; // always defaulted to [] by the runner -> never hits the DB
  routes?: CaseRoutes; // routes mode only
}

export interface Suite {
  suite: string;
  mode: "routes" | "corpus";
  corpus?: Corpus; // corpus mode only
  cases: EvalCase[];
}

export interface CaseResult {
  suite: string;
  name: string;
  passed: boolean;
  failures: string[]; // human-readable assertion failures (empty when passed)
  got: string[]; // actual final ids
}
