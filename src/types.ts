// Core domain types. ids are strings (BIGINT/AUTO_RANDOM -> JS-safe via bigNumberStrings).

export type SourceTrust = "owner" | "untrusted";
export type FactState = "active" | "superseded" | "archived" | "deleted";
export type FactKind = "event" | "preference" | "commitment" | "belief" | "fact";
export type GeneratedBy = "extraction" | "dream" | "summary";

export interface Fact {
  id: string;
  claim: string;
  kind: FactKind;
  state: FactState;
  /** Provenance of the source text (98 §3.5). untrusted = pasted/forwarded/OCR/external. */
  sourceTrust: SourceTrust;
  validFrom: string | null;
  recordedAt: string;
}

export interface Entity {
  id: string;
  slug: string;
  name: string;
  kind: "person" | "org" | "place" | "topic" | "event" | "other";
}

export type SearchRoute = "vector" | "fts" | "entity";

export interface SearchHit {
  id: string;
  claim: string;
  sourceTrust: SourceTrust;
  /** Fused score (higher = better) after RRF + boosts. */
  score: number;
  /** Routes that surfaced this hit. */
  routes: SearchRoute[];
  /** Cosine distance from the vector/entity route, if any (lower = closer). */
  distance?: number;
}

export interface SearchOptions {
  /** Candidates pulled per route before fusion. */
  candidatesPerRoute?: number;
  /** Final result count after autocut. */
  limit?: number;
  /** Entity ids already resolved from the query (entity-route). */
  entityIds?: string[];
}
