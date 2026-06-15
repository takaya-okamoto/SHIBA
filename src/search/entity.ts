import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../index/db.js";

interface EntityRow extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
  aliases: string[] | string | null;
  mention_count: number;
}

export interface EntityCandidate {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  mentionCount?: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure, confidence-gated entity resolution (docs/101 §5). Ranks known entities by how the query
 * references them — exact slug token (3) > name substring (2) > alias substring (1) — and only
 * returns ones that actually matched (the gate that keeps unrelated entities from being pulled into
 * the entity-route, 101 §7). Ties break on mention_count. Trigram / embedding-cosine / LLM
 * disambiguation are later refinements; this already beats the naive whole-list substring scan.
 */
export function rankEntities(query: string, entities: EntityCandidate[], max = 3): string[] {
  const q = query.toLowerCase();
  const scored: { id: string; score: number; mentions: number }[] = [];
  for (const e of entities) {
    const slug = e.slug.toLowerCase();
    let score = 0;
    if (
      slug.length >= 2 &&
      new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(slug)}([^a-z0-9_-]|$)`).test(q)
    ) {
      score = 3;
    } else if (e.name.length >= 2 && query.includes(e.name)) {
      score = 2;
    } else if (e.aliases?.some((a) => a.length >= 2 && query.includes(a))) {
      score = 1;
    }
    if (score > 0) scored.push({ id: e.id, score, mentions: e.mentionCount ?? 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.mentions - a.mentions);
  return scored.slice(0, max).map((s) => s.id);
}

/** Parse the JSON aliases column (mysql2 may hand back a parsed array or a raw string). */
function parseAliases(v: string[] | string | null): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Resolve entities mentioned in the query -> entity ids (triggers the entity-route, 101 §7). */
export async function resolveEntities(query: string, max = 3): Promise<string[]> {
  const pool: Pool = getPool();
  const [rows] = await pool.query<EntityRow[]>(
    "SELECT id, name, slug, aliases, mention_count FROM entities ORDER BY mention_count DESC LIMIT 1000",
  );
  const candidates: EntityCandidate[] = rows.map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    aliases: parseAliases(e.aliases),
    mentionCount: Number(e.mention_count ?? 0),
  }));
  return rankEntities(query, candidates, max);
}
