import { config } from "../config.js";
import type { SearchHit, SearchOptions } from "../types.js";
import { resolveEntities } from "./entity.js";
import { type RouteHit, type SearchProvider, TidbSearchProvider } from "./provider.js";
import {
  type RankedList,
  autocut,
  demoteUntrusted,
  recencyBoost,
  rescueFromFts,
  rrfFuse,
} from "./rrf.js";

/** Read = fail-open (docs/96 C-1): a failing route degrades to []; recall never throws on one bad route. */
async function settle(label: string, p: Promise<RouteHit[]>): Promise<RouteHit[]> {
  try {
    return await p;
  } catch (e) {
    console.warn(`[search] route ${label} degraded: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Hybrid recall (docs/91 §2.3, 101 §7): text-route (vector + FTS over facts AND chunks) + entity-
 * route, fused by RRF, untrusted demoted (98 §3.5), recency-decayed (90 §3), then autocut. Each route
 * is fail-open, so a degraded route (e.g. FTS preview erroring) still returns the others. If fusion
 * comes back empty but the keyword route matched, a rescue fallback surfaces those hits (openclaw
 * lesson). Stays at a handful of queries — no graph BFS, since connections are materialized at write.
 */
export async function search(
  query: string,
  opts: SearchOptions = {},
  provider: SearchProvider = new TidbSearchProvider(),
): Promise<SearchHit[]> {
  const k = opts.candidatesPerRoute ?? config.search.candidatesPerRoute;
  const limit = opts.limit ?? config.search.limit;
  const entityIds = opts.entityIds ?? (await resolveEntities(query).catch(() => []));

  // text-route: vector + FTS over both facts and prose chunks, in parallel (each fail-open)
  const [vec, fts, chunkVec, chunkFts] = await Promise.all([
    settle("vector", provider.vectorRoute(query, k)),
    settle("fts", provider.ftsRoute(query, k)),
    settle("chunk-vector", provider.chunkVectorRoute(query, k)),
    settle("chunk-fts", provider.chunkFtsRoute(query, k)),
  ]);
  const lists: RankedList[] = [
    { route: "vector", hits: vec },
    { route: "vector", hits: chunkVec },
    { route: "fts", hits: fts },
    { route: "fts", hits: chunkFts },
  ];

  // entity-route: only when the query resolved to entities (gate avoids irrelevant pulls, 101 §7)
  if (entityIds.length > 0) {
    const routes = await Promise.all(
      entityIds.map((id) => settle(`entity:${id}`, provider.entityRoute(id, query, k))),
    );
    for (const hits of routes) lists.push({ route: "entity", hits });
  }

  let fused = rrfFuse(lists, config.search.rrfK);
  fused = demoteUntrusted(fused);
  // recency decay: dated facts (event/commitment) fade with age; evergreen kinds are exempt (90 §3).
  if (config.search.decayEnabled) {
    fused = recencyBoost(fused, Date.now(), config.search.recencyHalfLifeDays);
  }
  // TODO (101 §7): graph-adjacency boost + cross-encoder rerank.
  const result = autocut(fused, limit);
  if (result.length === 0) {
    // Final guard: if fusion is empty but the keyword route matched, surface those (openclaw lesson).
    const rescue = rescueFromFts([...fts, ...chunkFts], limit);
    if (rescue.length > 0) return rescue;
  }
  return result;
}
