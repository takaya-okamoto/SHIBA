import type { SearchHit, SearchRoute } from "../types.js";
import type { RouteHit } from "./provider.js";

export interface RankedList {
  route: SearchRoute;
  hits: RouteHit[];
}

/** Reciprocal Rank Fusion: score = Σ over lists of 1/(k + rank). Rewards multi-route agreement. */
export function rrfFuse(lists: RankedList[], rrfK: number): SearchHit[] {
  const acc = new Map<string, SearchHit>();
  for (const { route, hits } of lists) {
    hits.forEach((h, i) => {
      const inc = 1 / (rrfK + i + 1);
      const cur = acc.get(h.id);
      if (cur) {
        cur.score += inc;
        if (!cur.routes.includes(route)) cur.routes.push(route);
        if (h.distance !== undefined && (cur.distance === undefined || h.distance < cur.distance)) {
          cur.distance = h.distance;
        }
      } else {
        acc.set(h.id, {
          id: h.id,
          claim: h.claim,
          sourceTrust: h.sourceTrust,
          score: inc,
          routes: [route],
          distance: h.distance,
        });
      }
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

/** Demote untrusted-origin hits so trusted memory ranks first (docs/98 §3.5). */
export function demoteUntrusted(hits: SearchHit[], factor = 0.5): SearchHit[] {
  return hits
    .map((h) => (h.sourceTrust === "untrusted" ? { ...h, score: h.score * factor } : h))
    .sort((a, b) => b.score - a.score);
}

/** Autocut: keep the prefix before the largest score drop (gbrain-style; tune in eval). */
export function autocut(hits: SearchHit[], limit: number): SearchHit[] {
  const top = hits.slice(0, limit);
  if (top.length <= 2) return top;
  let cut = top.length;
  let maxGap = -1;
  for (let i = 1; i < top.length; i++) {
    const gap = (top[i - 1]?.score ?? 0) - (top[i]?.score ?? 0);
    if (gap > maxGap) {
      maxGap = gap;
      cut = i;
    }
  }
  return top.slice(0, cut);
}
