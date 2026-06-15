import type { LlmClient } from "../llm/client.js";
import type { FenceFact } from "../memory/fence.js";
import { detectInjection } from "../security/injection.js";
import { scrubSecrets } from "../security/redact.js";
import { sanitizeText, stripInjectedContext } from "../security/sanitize.js";
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
export function parseExtractionOutput(
  raw: unknown,
  messageTrust: SourceTrust,
  scrubPii = true,
): FenceFact[] {
  const arr = Array.isArray(raw) ? raw : (raw as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(arr)) return [];
  const out: FenceFact[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    // Sanitize + scrub the model's output too (docs/98 §2.2): a claim is written to memory and
    // re-injected later, so a leaked secret / homoglyph delimiter must not survive the round-trip.
    const claim =
      typeof o.claim === "string"
        ? scrubSecrets(sanitizeText(o.claim.trim()), { pii: scrubPii })
        : "";
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

export interface ExtractOptions {
  /** Date the message was received (YYYY-MM-DD) — anchors relative dates (docs/94 A-4). */
  observationDate?: string;
  /** Scrub PII (email/phone) from the memory path. Default true (docs/98 §4.2). */
  scrubPii?: boolean;
}

/**
 * Stage 1 extraction (docs/95 B-4): turn text -> atomic facts with source_trust.
 * The input is hardened before it reaches the LLM (docs/98 §2-4): strip injected blocks (self-
 * contamination, §3.1), Unicode-sanitize (§2.3), detect+log injection patterns (§2.2, detect != block),
 * then scrub secrets/PII (§4.2). TODO stage 2: reconcile (ADD/UPDATE/DELETE) against existing memory.
 */
export async function extractFacts(
  turnText: string,
  provenance: Provenance,
  llm: LlmClient,
  opts: ExtractOptions = {},
): Promise<FenceFact[]> {
  const messageTrust = trustForProvenance(provenance);
  const scrubPii = opts.scrubPii ?? true;
  const sanitized = sanitizeText(stripInjectedContext(turnText));
  const injection = detectInjection(sanitized);
  if (injection.detected) {
    // detect != block (docs/98 §2.2): log + (TODO C2/E3) count; rely on the structural delimiter.
    console.warn(
      `[security] injection patterns in extraction input (provenance=${provenance}): ${injection.patterns.join(", ")}`,
    );
  }
  const scrubbed = scrubSecrets(sanitized, { pii: scrubPii });
  let raw: unknown;
  try {
    raw = await llm.json(EXTRACT_SYSTEM, extractUserPrompt(scrubbed, opts.observationDate));
  } catch {
    return []; // extraction failed => extract nothing (don't guess)
  }
  return parseExtractionOutput(raw, messageTrust, scrubPii);
}
