import type { Pool, RowDataPacket } from "mysql2/promise";
import { type EmbeddingProvider, getEmbeddingProvider } from "../index/embed.js";
import { getPool } from "../index/db.js";
import type { SourceTrust } from "../types.js";
import { ftsLiteral } from "./fts.js";

export interface RouteHit {
  id: string;
  claim: string;
  sourceTrust: SourceTrust;
  distance?: number; // present for vector / entity routes (cosine; lower = closer)
}

export interface SearchProvider {
  vectorRoute(query: string, k: number): Promise<RouteHit[]>;
  ftsRoute(query: string, k: number): Promise<RouteHit[]>;
  entityRoute(entityId: string, query: string, k: number): Promise<RouteHit[]>;
}

interface FactRow extends RowDataPacket {
  id: string;
  claim: string;
  source_trust: SourceTrust;
  d: number | null;
}

const toHits = (rows: FactRow[]): RouteHit[] =>
  rows.map((r) => ({
    id: r.id,
    claim: r.claim,
    sourceTrust: r.source_trust,
    distance: r.d ?? undefined,
  }));

/**
 * TiDB-backed routes (validated by poc/tidb on Tokyo Starter).
 * `SearchProvider` is the swap point for a LIKE fallback if FTS preview misbehaves (docs/91 §2.4-4).
 */
export class TidbSearchProvider implements SearchProvider {
  private pool: Pool;
  private embed: EmbeddingProvider;
  constructor() {
    this.pool = getPool();
    this.embed = getEmbeddingProvider();
  }

  // text-route A — vector over active facts. The distance expr is byte-identical in SELECT and
  // ORDER BY so the vector index can apply (mem9/PoC lesson).
  async vectorRoute(query: string, k: number): Promise<RouteHit[]> {
    const dist = this.embed.distanceExpr("embedding");
    const p = this.embed.distanceParams(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, ${dist} AS d
         FROM facts WHERE state = 'active'
         ORDER BY ${dist} LIMIT ?`,
      [...p, ...p, k],
    );
    return toHits(rows);
  }

  // text-route B — full-text. FTS_MATCH_WORD needs a constant -> inline + escape (98 §6).
  async ftsRoute(query: string, k: number): Promise<RouteHit[]> {
    const lit = ftsLiteral(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, NULL AS d
         FROM facts
         WHERE state = 'active' AND FTS_MATCH_WORD(${lit}, claim)
         ORDER BY FTS_MATCH_WORD(${lit}, claim) DESC LIMIT ?`,
      [k],
    );
    return toHits(rows);
  }

  // entity-route — the 10x lever. VALIDATED scale-safe form (poc/tidb/explain.ts): the IN-subquery
  // drives from idx_fe_entity(entity_id) -> point-fetches those facts -> exact vector over the small
  // subset. (The JOIN form full-scanned facts under stats:pseudo; this form does not.)
  async entityRoute(entityId: string, query: string, k: number): Promise<RouteHit[]> {
    const dist = this.embed.distanceExpr("embedding");
    const p = this.embed.distanceParams(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, ${dist} AS d
         FROM facts
         WHERE id IN (SELECT fact_id FROM fact_entities WHERE entity_id = ?)
           AND state = 'active'
         ORDER BY ${dist} LIMIT ?`,
      [...p, entityId, ...p, k],
    );
    return toHits(rows);
  }
}
