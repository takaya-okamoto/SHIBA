import type { Pool, RowDataPacket } from "mysql2/promise";
import { config } from "../config.js";
import { getPool } from "../index/db.js";
import { type EmbeddingProvider, getEmbeddingProvider } from "../index/embed.js";
import type { FactKind, SourceTrust } from "../types.js";
import { ftsLiteral, likePattern } from "./fts.js";

export interface RouteHit {
  id: string;
  claim: string;
  sourceTrust: SourceTrust;
  kind?: FactKind; // set by toHits for fact routes; optional so test fakes can omit it
  recordedAt?: string; // ISO; for recency decay (rrf.recencyBoost)
  distance?: number; // present for vector / entity routes (cosine; lower = closer)
}

export interface SearchProvider {
  vectorRoute(query: string, k: number): Promise<RouteHit[]>;
  ftsRoute(query: string, k: number): Promise<RouteHit[]>;
  entityRoute(entityId: string, query: string, k: number): Promise<RouteHit[]>;
  /** Vector route over Markdown chunks (prose memos, not just fenced facts) — docs/91 §2.2-2.3. */
  chunkVectorRoute(query: string, k: number): Promise<RouteHit[]>;
  /** Keyword route over chunks. */
  chunkFtsRoute(query: string, k: number): Promise<RouteHit[]>;
}

interface FactRow extends RowDataPacket {
  id: string;
  claim: string;
  source_trust: SourceTrust;
  kind: FactKind;
  recorded_at: Date | string | null;
  d: number | null;
}

const toHits = (rows: FactRow[]): RouteHit[] =>
  rows.map((r) => ({
    id: r.id,
    claim: r.claim,
    sourceTrust: r.source_trust,
    kind: r.kind,
    recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : undefined,
    distance: r.d ?? undefined,
  }));

interface ChunkRow extends RowDataPacket {
  id: string;
  content: string;
  source_trust: SourceTrust;
  d: number | null;
}

// Chunk ids are namespaced (`c:`) so they can't collide with fact ids during RRF fusion. Chunks have
// no fact `kind`, so recency decay (which keys on dated kinds) leaves them untouched — correct, a
// prose memo isn't a dated fact.
const chunkToHits = (rows: ChunkRow[]): RouteHit[] =>
  rows.map((r) => ({
    id: `c:${r.id}`,
    claim: r.content,
    sourceTrust: r.source_trust,
    distance: r.d ?? undefined,
  }));

/**
 * TiDB-backed routes (validated by poc/tidb on Tokyo Starter). Fact routes query `facts`; chunk
 * routes query `chunks` (prose memos). The keyword routes honor `config.search.ftsMode` so a LIKE
 * substring fallback can replace FTS preview if it misbehaves (docs/91 §2.4-4).
 */
export class TidbSearchProvider implements SearchProvider {
  private pool: Pool;
  private embed: EmbeddingProvider;
  private likeMode: boolean;
  constructor() {
    this.pool = getPool();
    this.embed = getEmbeddingProvider();
    this.likeMode = config.search.ftsMode === "like";
  }

  // text-route A — vector over active facts. The distance expr is byte-identical in SELECT and
  // ORDER BY so the vector index can apply (mem9/PoC lesson).
  async vectorRoute(query: string, k: number): Promise<RouteHit[]> {
    const dist = this.embed.distanceExpr("embedding");
    const p = this.embed.distanceParams(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, kind, recorded_at, ${dist} AS d
         FROM facts WHERE state = 'active'
         ORDER BY ${dist} LIMIT ?`,
      [...p, ...p, k],
    );
    return toHits(rows);
  }

  // text-route B — full-text. FTS_MATCH_WORD needs a constant -> inline + escape (98 §6).
  // LIKE mode is the bound-param substring fallback (docs/91 §2.4-4).
  async ftsRoute(query: string, k: number): Promise<RouteHit[]> {
    if (this.likeMode) {
      const [rows] = await this.pool.query<FactRow[]>(
        `SELECT id, claim, source_trust, kind, recorded_at, NULL AS d
           FROM facts WHERE state = 'active' AND claim LIKE ? ESCAPE '\\' LIMIT ?`,
        [likePattern(query), k],
      );
      return toHits(rows);
    }
    const lit = ftsLiteral(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, kind, recorded_at, NULL AS d
         FROM facts
         WHERE state = 'active' AND FTS_MATCH_WORD(${lit}, claim)
         ORDER BY FTS_MATCH_WORD(${lit}, claim) DESC LIMIT ?`,
      [k],
    );
    return toHits(rows);
  }

  // chunk text-route A — vector over Markdown chunks (prose memos).
  async chunkVectorRoute(query: string, k: number): Promise<RouteHit[]> {
    const dist = this.embed.distanceExpr("embedding");
    const p = this.embed.distanceParams(query);
    const [rows] = await this.pool.query<ChunkRow[]>(
      `SELECT id, content, source_trust, ${dist} AS d
         FROM chunks ORDER BY ${dist} LIMIT ?`,
      [...p, ...p, k],
    );
    return chunkToHits(rows);
  }

  // chunk keyword-route — FTS (or LIKE fallback) over chunk content.
  async chunkFtsRoute(query: string, k: number): Promise<RouteHit[]> {
    if (this.likeMode) {
      const [rows] = await this.pool.query<ChunkRow[]>(
        `SELECT id, content, source_trust, NULL AS d FROM chunks WHERE content LIKE ? ESCAPE '\\' LIMIT ?`,
        [likePattern(query), k],
      );
      return chunkToHits(rows);
    }
    const lit = ftsLiteral(query);
    const [rows] = await this.pool.query<ChunkRow[]>(
      `SELECT id, content, source_trust, NULL AS d
         FROM chunks WHERE FTS_MATCH_WORD(${lit}, content)
         ORDER BY FTS_MATCH_WORD(${lit}, content) DESC LIMIT ?`,
      [k],
    );
    return chunkToHits(rows);
  }

  // entity-route — the 10x lever. VALIDATED scale-safe form (poc/tidb/explain.ts): the IN-subquery
  // drives from idx_fe_entity(entity_id) -> point-fetches those facts -> exact vector over the small
  // subset. (The JOIN form full-scanned facts under stats:pseudo; this form does not.)
  async entityRoute(entityId: string, query: string, k: number): Promise<RouteHit[]> {
    const dist = this.embed.distanceExpr("embedding");
    const p = this.embed.distanceParams(query);
    const [rows] = await this.pool.query<FactRow[]>(
      `SELECT id, claim, source_trust, kind, recorded_at, ${dist} AS d
         FROM facts
         WHERE id IN (SELECT fact_id FROM fact_entities WHERE entity_id = ?)
           AND state = 'active'
         ORDER BY ${dist} LIMIT ?`,
      [...p, entityId, ...p, k],
    );
    return toHits(rows);
  }
}
