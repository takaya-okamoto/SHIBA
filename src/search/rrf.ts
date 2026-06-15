import type { FactKind, SearchHit, SearchRoute } from "../types.js";
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
          recordedAt: h.recordedAt,
          kind: h.kind,
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

/** Kinds that fade with age. Evergreen kinds (preference/belief/fact) are exempt from recency decay. */
const DATED_KINDS = new Set<FactKind>(["event", "commitment"]);

/**
 * Recency decay (docs/90 §3-①-3, openclaw temporal-decay): dated facts lose weight with age,
 * `score *= exp(-(ln2 / halfLifeDays) * ageDays)`, based on recorded_at. Evergreen kinds and hits
 * without a recorded_at are left untouched. `nowMs` is injected for testability.
 */
export function recencyBoost(hits: SearchHit[], nowMs: number, halfLifeDays: number): SearchHit[] {
  const k = Math.LN2 / halfLifeDays;
  return hits
    .map((h) => {
      if (!h.recordedAt || !h.kind || !DATED_KINDS.has(h.kind)) return h;
      const ageDays = Math.max(0, (nowMs - Date.parse(h.recordedAt)) / 86_400_000);
      return { ...h, score: h.score * Math.exp(-k * ageDays) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Zero-hit rescue (docs/91 §2.3, openclaw lesson): when fusion produced nothing usable but the
 * keyword route did match, return those raw FTS hits rather than "(no memory)". Dedups by id and
 * demotes untrusted. Pure — `ftsHits` are the raw RouteHits from the keyword route(s).
 */
export function rescueFromFts(ftsHits: RouteHit[], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of ftsHits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({
      id: h.id,
      claim: h.claim,
      sourceTrust: h.sourceTrust,
      score: 1,
      routes: ["fts"],
      distance: h.distance,
      recordedAt: h.recordedAt,
      kind: h.kind,
    });
  }
  return demoteUntrusted(out).slice(0, limit);
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
