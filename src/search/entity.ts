import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "../index/db.js";

interface EntityRow extends RowDataPacket {
  id: string;
  name: string;
  slug: string;
}

/**
 * Resolve entities mentioned in the query -> entity ids (triggers the entity-route, 101 §7).
 * SKELETON: substring match against known entity names, ranked by mention_count.
 * TODO: exact slug -> trigram -> embedding cosine -> (rare) LLM disambiguation, with a
 * confidence gate so unrelated entities don't get pulled (101 §5); sanitize untrusted text (98 §6).
 */
export async function resolveEntities(query: string, max = 3): Promise<string[]> {
  const pool: Pool = getPool();
  const [rows] = await pool.query<EntityRow[]>(
    "SELECT id, name, slug FROM entities ORDER BY mention_count DESC LIMIT 500",
  );
  return rows
    .filter((e) => e.name.length >= 2 && query.includes(e.name))
    .slice(0, max)
    .map((e) => e.id);
}
