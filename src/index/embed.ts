import { config } from "../config.js";

/**
 * EmbeddingProvider abstraction (docs/91 §2.4-7). Two modes:
 *  - "tidb-auto" (default): embeddings are a GENERATED column (EMBED_TEXT); the DB embeds on
 *    write and on query (VEC_EMBED_COSINE_DISTANCE). The app does NOT embed — these helpers
 *    return the model string and SQL fragments so callers stay provider-agnostic.
 *  - "local": the app embeds and INSERTs VECTOR(...) itself; search uses VEC_COSINE_DISTANCE
 *    against an app-supplied vector. (TODO: wire a local embedder; out of scope for the skeleton.)
 */
export interface EmbeddingProvider {
  readonly mode: "tidb-auto" | "local";
  readonly model: string;
  readonly dimension: number;
  /** SQL distance expression for the query side, given a bound-param placeholder for the query. */
  distanceExpr(embeddingCol: string): string;
  /** Params the distanceExpr consumes for one query string. */
  distanceParams(queryText: string): unknown[];
}

class TidbAutoEmbedding implements EmbeddingProvider {
  readonly mode = "tidb-auto" as const;
  constructor(
    readonly model: string,
    readonly dimension: number,
  ) {}
  // VEC_EMBED_COSINE_DISTANCE embeds the query string via the DB-managed model -> same model as
  // the stored column (no client/server version skew). One bound param per occurrence.
  distanceExpr(col: string): string {
    return `VEC_EMBED_COSINE_DISTANCE(${col}, ?)`;
  }
  distanceParams(queryText: string): unknown[] {
    return [queryText];
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (config.embedding.provider === "local") {
    throw new Error("EMBED_PROVIDER=local not implemented yet (skeleton). Use tidb-auto.");
  }
  return new TidbAutoEmbedding(config.embedding.model, config.embedding.dimension);
}
