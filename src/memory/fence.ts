import type { FactKind, SourceTrust } from "../types.js";

/** A fact as written in the Markdown facts fence (the source of truth; no DB id). */
export interface FenceFact {
  claim: string;
  kind: FactKind;
  entities: string[]; // slugs
  validFrom: string | null; // YYYY-MM-DD (event date)
  sourceTrust: SourceTrust;
  state: "active" | "superseded"; // strikethrough => superseded (docs/94 A-3)
}

const KINDS = new Set<FactKind>(["event", "preference", "commitment", "belief", "fact"]);
const FENCE_OPEN = /^```facts(?:\s+v\d+)?\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/**
 * Line grammar (human-readable + round-trippable):
 *   - [kind] claim text @entitySlug @another ^2026-06-10 !untrusted
 *   - ~~[kind] struck claim~~ @slug        (strikethrough => superseded / forgotten)
 * Tokens: @slug (entity), ^YYYY-MM-DD (valid_from), !untrusted (source_trust; default owner).
 */
export function parseFacts(md: string): FenceFact[] {
  const out: FenceFact[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!inFence) {
      if (FENCE_OPEN.test(t)) inFence = true;
      continue;
    }
    if (FENCE_CLOSE.test(t)) {
      inFence = false;
      continue;
    }
    const fact = parseFactLine(line);
    if (fact) out.push(fact);
  }
  return out;
}

export function parseFactLine(raw: string): FenceFact | null {
  let s = raw.trim();
  if (!s.startsWith("- ")) return null;
  s = s.slice(2).trim();

  const entities: string[] = [];
  s = s.replace(/@([a-z0-9_-]+)/g, (_m, slug: string) => {
    entities.push(slug);
    return "";
  });
  let validFrom: string | null = null;
  s = s.replace(/\^(\d{4}-\d{2}-\d{2})/, (_m, d: string) => {
    validFrom = d;
    return "";
  });
  let sourceTrust: SourceTrust = "owner";
  if (/!untrusted\b/.test(s)) {
    sourceTrust = "untrusted";
    s = s.replace(/!untrusted\b/, "");
  }
  s = s.replace(/\s+/g, " ").trim();

  let state: "active" | "superseded" = "active";
  const strike = s.match(/^~~(.*)~~$/);
  if (strike) {
    state = "superseded";
    s = strike[1]!.trim();
  }

  const km = s.match(/^\[(\w+)\]\s*(.*)$/);
  if (!km) return null;
  const kind = km[1] as FactKind;
  if (!KINDS.has(kind)) return null;
  const claim = km[2]!.trim();
  if (!claim) return null;

  return { claim, kind, entities: [...new Set(entities)], validFrom, sourceTrust, state };
}

export function serializeFactLine(f: FenceFact): string {
  const core = `[${f.kind}] ${f.claim}`;
  const body = f.state === "superseded" ? `~~${core}~~` : core;
  const ents = f.entities.map((e) => ` @${e}`).join("");
  const vf = f.validFrom ? ` ^${f.validFrom}` : "";
  const ut = f.sourceTrust === "untrusted" ? " !untrusted" : "";
  return `- ${body}${ents}${vf}${ut}`;
}

export function serializeFactsBlock(facts: FenceFact[]): string {
  return ["```facts v1", ...facts.map(serializeFactLine), "```"].join("\n");
}
