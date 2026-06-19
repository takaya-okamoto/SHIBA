// Offline SearchProviders for the eval harness. Both feed the real `search()` so the fusion
// pipeline (rrf/demote/recency/autocut) is exercised end-to-end without a live TiDB.

import type { RouteHit, SearchProvider } from "../search/provider.js";
import type { CaseRoutes, Corpus, CorpusChunkSpec, CorpusFactSpec, HitSpec } from "./types.js";

function toHit(s: HitSpec): RouteHit {
  return {
    id: s.id,
    claim: s.claim,
    sourceTrust: s.trust ?? "owner",
    kind: s.kind,
    recordedAt: s.recordedAt,
    distance: s.distance,
  };
}

/**
 * Routes mode: replay exactly the RouteHits a case declares for each route. This regresses OUR
 * fusion math against precisely what the real routes would return — the openclaw "keyword-only hit
 * dropped" bug lives in fusion, so this is the faithful place to guard it. The same `entity` list
 * answers every entity id (fixtures use a single entity).
 */
export function routeProvider(routes: CaseRoutes): SearchProvider {
  const fixed = (hits?: HitSpec[]): (() => Promise<RouteHit[]>) => {
    const out = (hits ?? []).map(toHit);
    return async () => out;
  };
  return {
    vectorRoute: fixed(routes.vector),
    ftsRoute: fixed(routes.fts),
    chunkVectorRoute: fixed(routes.chunkVector),
    chunkFtsRoute: fixed(routes.chunkFts),
    entityRoute: fixed(routes.entity),
  };
}

/**
 * LIKE-fallback proxy. Faithful *enough* to the keyword retreat (`claim LIKE %q%`, docs/91 §2.1) to
 * regress our pipeline offline: case-sensitive substring (CJK has no case; ASCII fixtures choose
 * their own casing). It is deliberately NOT a TiDB FTS/collation oracle — exact engine behavior is
 * validated by the nightly DB-backed run (fixtures/README.md).
 */
function likeMatch(text: string, query: string): boolean {
  return text.includes(query);
}

/**
 * Corpus mode: keyword routes do real substring matching over an in-memory corpus; vector routes
 * return [] (no offline embeddings), which is the point — it isolates the keyword/LIKE fallback the
 * doc says CI must cover. Chunk ids are namespaced `c:` exactly like the real provider.
 */
export class CorpusProvider implements SearchProvider {
  private facts: CorpusFactSpec[];
  private chunks: CorpusChunkSpec[];
  constructor(corpus: Corpus) {
    this.facts = corpus.facts ?? [];
    this.chunks = corpus.chunks ?? [];
  }

  private factHit(f: CorpusFactSpec): RouteHit {
    return {
      id: f.id,
      claim: f.claim,
      sourceTrust: f.trust ?? "owner",
      kind: f.kind,
      recordedAt: f.recordedAt,
    };
  }

  private chunkHit(c: CorpusChunkSpec): RouteHit {
    return { id: `c:${c.id}`, claim: c.content, sourceTrust: c.trust ?? "owner" };
  }

  async vectorRoute(): Promise<RouteHit[]> {
    return [];
  }

  async chunkVectorRoute(): Promise<RouteHit[]> {
    return [];
  }

  async ftsRoute(query: string, k: number): Promise<RouteHit[]> {
    return this.facts
      .filter((f) => likeMatch(f.claim, query))
      .slice(0, k)
      .map((f) => this.factHit(f));
  }

  async chunkFtsRoute(query: string, k: number): Promise<RouteHit[]> {
    return this.chunks
      .filter((c) => likeMatch(c.content, query))
      .slice(0, k)
      .map((c) => this.chunkHit(c));
  }

  // Entity route is vector-ranked in prod; offline we just surface facts linked to the entity in
  // corpus order (enough to regress the entity-route wiring + fusion, not the ranking).
  async entityRoute(entityId: string, _query: string, k: number): Promise<RouteHit[]> {
    return this.facts
      .filter((f) => f.entities?.includes(entityId))
      .slice(0, k)
      .map((f) => this.factHit(f));
  }
}
