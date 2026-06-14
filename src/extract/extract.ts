import type { LlmClient } from "../llm/client.js";
import type { FenceFact } from "../memory/fence.js";
import type { FactKind, SourceTrust } from "../types.js";
import { EXTRACT_SYSTEM, extractUserPrompt } from "./prompts.js";

const KINDS = new Set<FactKind>(["event", "preference", "commitment", "belief", "fact"]);
const SLUG = /^[a-z0-9_-]+$/;

/** Where the turn text came from (docs/98 §3.5). owner-typed = trusted; everything else = untrusted. */
export type Provenance = "owner-typed" | "pasted" | "forwarded" | "ocr";

export function trustForProvenance(p: Provenance): SourceTrust {
  return p === "owner-typed" ? "owner" : "untrusted";
}

/**
 * Validate the LLM's JSON into FenceFacts. Invalid facts are DROPPED (never the
 * "ADD every line on parse failure" anti-pattern, docs/90 §4). Clamps source_trust:
 * an untrusted message forces every fact untrusted; an owner message trusts the per-fact tag.
 */
export function parseExtractionOutput(raw: unknown, messageTrust: SourceTrust): FenceFact[] {
  const arr = Array.isArray(raw) ? raw : (raw as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(arr)) return [];
  const out: FenceFact[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const claim = typeof o.claim === "string" ? o.claim.trim() : "";
    const kind = o.kind as FactKind;
    if (!claim || !KINDS.has(kind)) continue;
    const entities = Array.isArray(o.entities)
      ? o.entities.filter((e): e is string => typeof e === "string" && SLUG.test(e))
      : [];
    const validFrom =
      typeof o.valid_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.valid_from)
        ? o.valid_from
        : null;
    const sourceTrust: SourceTrust =
      messageTrust === "untrusted"
        ? "untrusted"
        : o.source_trust === "untrusted"
          ? "untrusted"
          : "owner";
    out.push({
      claim,
      kind,
      entities: [...new Set(entities)],
      validFrom,
      sourceTrust,
      state: "active",
    });
  }
  return out;
}

/**
 * Stage 1 extraction (docs/95 B-4): turn text -> atomic facts with source_trust.
 * TODO stage 2: reconcile (ADD/UPDATE/DELETE) against existing memory before writing.
 */
export async function extractFacts(
  turnText: string,
  provenance: Provenance,
  llm: LlmClient,
): Promise<FenceFact[]> {
  const messageTrust = trustForProvenance(provenance);
  let raw: unknown;
  try {
    raw = await llm.json(EXTRACT_SYSTEM, extractUserPrompt(turnText));
  } catch {
    return []; // extraction failed => extract nothing (don't guess)
  }
  return parseExtractionOutput(raw, messageTrust);
}
