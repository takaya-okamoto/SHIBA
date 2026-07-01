/**
 * Entity resolution (docs/101 §5). The extractor invents a fresh slug per surface form, so the same
 * real-world entity fragments into many nodes (`mori-president` / `mori_president` / `morishima-shacho`).
 * That fragments the entity-route recall. We fix it deterministically, AFTER extraction, in two layers:
 *
 *   1. `canonicalizeSlug` — format normalization (lowercase, unify `_`/space -> `-`). Merges pure
 *      spelling variants with zero config (`mori_president` == `mori-president`).
 *   2. an owner-editable alias map (`<memory-root>/aliases.yaml`, versioned + backed up) — semantic
 *      merges the format pass can't know (`owner` -> `okamoto-takaya`, `tuzura` -> `tsugumi-restaurant`)
 *      plus the canonical display name + kind.
 *
 * Applied at reindex time, so it is self-healing: fix aliases.yaml, re-run `reindex`, and the split
 * nodes collapse — no need to rewrite every Markdown @tag (truth stays in Markdown).
 */
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { safeJoin } from "../memory/paths.js";

export type EntityKind = "person" | "org" | "place" | "topic" | "event" | "other";
const KINDS = new Set<EntityKind>(["person", "org", "place", "topic", "event", "other"]);

export interface EntityDef {
  /** Canonical slug every alias collapses into. */
  canonical: string;
  /** Human display name (defaults to the canonical slug). */
  name?: string;
  kind?: EntityKind;
  /** Variant slugs (any format) that mean the same entity. */
  aliases?: string[];
}
export interface AliasConfig {
  entities: EntityDef[];
}

/**
 * Deterministic slug normalization. Lowercase, collapse whitespace/underscores to a single `-`, trim.
 * `Mori_President` / `mori-president` / `mori  president` all -> `mori-president`.
 */
export function canonicalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface EntityResolver {
  /** Map any observed slug to its canonical slug (format-normalized + alias-merged). */
  resolve(slug: string): string;
  /** Display name + kind for a canonical slug (falls back to the slug / "other"). */
  meta(canonicalSlug: string): { name: string; kind: EntityKind };
}

/** Build a resolver from an alias config (null/undefined => identity resolver = format-only merge). */
export function buildResolver(cfg: AliasConfig | null | undefined): EntityResolver {
  const alias = new Map<string, string>(); // normalized variant -> canonical
  const meta = new Map<string, { name: string; kind: EntityKind }>();
  for (const e of cfg?.entities ?? []) {
    const canon = canonicalizeSlug(e.canonical ?? "");
    if (!canon) continue;
    alias.set(canon, canon);
    for (const a of e.aliases ?? []) {
      const na = canonicalizeSlug(a);
      if (na) alias.set(na, canon);
    }
    meta.set(canon, {
      name: e.name?.trim() || canon,
      kind: e.kind && KINDS.has(e.kind) ? e.kind : "other",
    });
  }
  return {
    resolve(slug) {
      const c = canonicalizeSlug(slug);
      return alias.get(c) ?? c;
    },
    meta(canon) {
      return meta.get(canon) ?? { name: canon, kind: "other" };
    },
  };
}

/**
 * Load `<root>/aliases.yaml` if present. Tolerant by design: a missing or malformed file yields null
 * (identity resolver) so a bad edit degrades to "no semantic merges", never a failed reindex.
 */
export async function loadAliasConfig(root: string): Promise<AliasConfig | null> {
  let text: string;
  try {
    text = await readFile(safeJoin(root, "aliases.yaml"), "utf8");
  } catch {
    return null; // no alias file -> identity resolver
  }
  try {
    const y = parse(text) as Partial<AliasConfig> | null;
    if (!y || !Array.isArray(y.entities)) return null;
    const entities = y.entities.filter(
      (e): e is EntityDef => typeof e?.canonical === "string" && e.canonical.length > 0,
    );
    return { entities };
  } catch {
    return null;
  }
}
