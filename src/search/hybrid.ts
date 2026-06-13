import { config } from "../config.js";
import type { SearchHit, SearchOptions } from "../types.js";
import { resolveEntities } from "./entity.js";
import { type SearchProvider, TidbSearchProvider } from "./provider.js";
import { autocut, demoteUntrusted, type RankedList, rrfFuse } from "./rrf.js";

/**
 * Hybrid recall (docs/91 §2.3, 101 §7): text-route (vector + FTS) + entity-route, fused by RRF,
 * untrusted demoted (98 §3.5), then autocut. The entity-route uses the validated scale-safe
 * IN-subquery (provider). Stays at a handful of queries — no graph BFS, since connections are
 * materialized at write time.
 */
export async function search(
  query: string,
  opts: SearchOptions = {},
  provider: SearchProvider = new TidbSearchProvider(),
): Promise<SearchHit[]> {
  const k = opts.candidatesPerRoute ?? config.search.candidatesPerRoute;
  const limit = opts.limit ?? config.search.limit;
  const entityIds = opts.entityIds ?? (await resolveEntities(query));

  const lists: RankedList[] = [];

  // text-route: vector + FTS in parallel
  const [vec, fts] = await Promise.all([provider.vectorRoute(query, k), provider.ftsRoute(query, k)]);
  lists.push({ route: "vector", hits: vec }, { route: "fts", hits: fts });

  // entity-route: only when the query resolved to entities (gate avoids irrelevant pulls, 101 §7)
  if (entityIds.length > 0) {
    const routes = await Promise.all(entityIds.map((id) => provider.entityRoute(id, query, k)));
    for (const hits of routes) lists.push({ route: "entity", hits });
  }

  let fused = rrfFuse(lists, config.search.rrfK);
  // TODO (101 §7): recency / evergreen boost + graph-adjacency boost + cross-encoder rerank.
  fused = demoteUntrusted(fused);
  return autocut(fused, limit);
}
