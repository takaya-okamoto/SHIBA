/**
 * In-turn memory write tools (docs/94 A-6, 91 §3.3): the model may actively `remember` a fact or
 * `forget` one when the owner explicitly asks, instead of waiting for the session-boundary extract.
 *
 * The full Anthropic memory_20250818 command set (view/create/str_replace/insert/delete/rename) is a
 * file-editing paradigm that doesn't fit our fence-fact model, so v1 exposes the two operations that
 * matter — append a fact, soft-delete a fact — reusing the same store primitives as the boundary
 * flush. The pure helpers here are unit-tested; the turn loop wires them to the store + reindex.
 */
import type { FenceFact } from "../memory/fence.js";
import type { StoredFact, SupersedeTarget } from "../memory/store.js";
import { scrubSecrets } from "../security/redact.js";
import { sanitizeText } from "../security/sanitize.js";
import type { FactKind } from "../types.js";

const WRITE_KINDS = new Set<FactKind>(["event", "preference", "commitment", "belief", "fact"]);
const SLUG = /^[a-z0-9_-]+$/;

/**
 * Build a fact from a `remember` tool call. Owner-trusted (the owner asked SHIBA to remember), but
 * still sanitized + secret-scrubbed like any memory write (docs/98 §2-4). Returns null if empty.
 */
export function buildRememberFact(
  input: Record<string, unknown>,
  scrubPii = true,
): FenceFact | null {
  const raw = typeof input.claim === "string" ? input.claim : "";
  const claim = scrubSecrets(sanitizeText(raw.trim()), { pii: scrubPii });
  if (!claim) return null;
  const kind = WRITE_KINDS.has(input.kind as FactKind) ? (input.kind as FactKind) : "fact";
  const entities = Array.isArray(input.entities)
    ? [...new Set(input.entities.filter((e): e is string => typeof e === "string" && SLUG.test(e)))]
    : [];
  return { claim, kind, entities, validFrom: null, sourceTrust: "owner", state: "active" };
}

/**
 * Active stored facts a `forget` query refers to. The model may paraphrase, so match either-way
 * substring; capped so a vague query can never mass-delete (soft-delete is reversible via git anyway).
 */
export function matchForget(facts: StoredFact[], query: string, cap = 5): StoredFact[] {
  const q = query.trim();
  if (!q) return [];
  const matches = facts.filter(
    (f) => f.state === "active" && (f.claim.includes(q) || q.includes(f.claim)),
  );
  return matches.slice(0, cap);
}

export function targetsOf(facts: StoredFact[]): SupersedeTarget[] {
  return facts.map((f) => ({ relPath: f.relPath, claim: f.claim }));
}
