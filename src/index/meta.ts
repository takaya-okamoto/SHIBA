/**
 * Index identity gate (docs/94 A-3, 93 A-3). `migrate` stamps the `meta` row with the schema version
 * and embedding model/dim; startup reads it back and compares with config. A schema mismatch is fatal
 * (refuse to start); an embedding mismatch is a warning (the vectors are stale — re-migrate + reindex).
 * This is the invariant that stops "changed EMBED_MODEL → silently serves wrong-dimension vectors".
 */
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";

export const SCHEMA_VERSION = 1;

export interface MetaRow {
  schemaVersion: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDim: number;
}

export interface MetaCheck {
  ok: boolean;
  schemaMismatch: boolean; // fatal — refuse to start
  embeddingMismatch: boolean; // serve but stale (re-embed needed)
  messages: string[];
}

export function expectedMeta(): MetaRow {
  return {
    schemaVersion: SCHEMA_VERSION,
    embeddingProvider: config.embedding.provider,
    embeddingModel: config.embedding.model,
    embeddingDim: config.embedding.dimension,
  };
}

/** Pure: compare stored meta against expected config (unit-tested without a DB). */
export function compareMeta(stored: MetaRow | null, expected: MetaRow): MetaCheck {
  if (!stored) {
    return {
      ok: true,
      schemaMismatch: false,
      embeddingMismatch: false,
      messages: ["no meta row yet (fresh index)"],
    };
  }
  const schemaMismatch = stored.schemaVersion !== expected.schemaVersion;
  const embeddingMismatch =
    stored.embeddingModel !== expected.embeddingModel ||
    stored.embeddingDim !== expected.embeddingDim;
  const messages: string[] = [];
  if (schemaMismatch) {
    messages.push(
      `schema version ${stored.schemaVersion} != ${expected.schemaVersion} — run migrate`,
    );
  }
  if (embeddingMismatch) {
    messages.push(
      `embedding ${stored.embeddingModel}@${stored.embeddingDim} != ${expected.embeddingModel}@${expected.embeddingDim} — re-migrate + reindex --all`,
    );
  }
  return { ok: !schemaMismatch && !embeddingMismatch, schemaMismatch, embeddingMismatch, messages };
}

export async function readMeta(pool: Pool): Promise<MetaRow | null> {
  try {
    const [rows] = await pool.query(
      "SELECT schema_version, embedding_provider, embedding_model, embedding_dim FROM meta WHERE id = 1",
    );
    const r = (rows as Array<Record<string, unknown>>)[0];
    if (!r) return null;
    return {
      schemaVersion: Number(r.schema_version),
      embeddingProvider: String(r.embedding_provider),
      embeddingModel: String(r.embedding_model),
      embeddingDim: Number(r.embedding_dim),
    };
  } catch {
    return null; // table missing (pre-migrate) — treat as fresh
  }
}

/** Startup gate. Throws on schema mismatch (fail-closed); logs a warning on embedding drift. */
export async function checkMeta(pool: Pool): Promise<MetaCheck> {
  const check = compareMeta(await readMeta(pool), expectedMeta());
  for (const m of check.messages) console.warn(`[meta] ${m}`);
  if (check.schemaMismatch) {
    throw new Error(
      `[meta] schema version mismatch — refusing to start. ${check.messages.join("; ")}`,
    );
  }
  return check;
}
