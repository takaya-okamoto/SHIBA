/**
 * Extraction stage 2 — reconcile new facts against existing memory (docs/95 B-4, 94 A-3b).
 *
 * Stage 1 produced atomic new facts. Before writing, compare them with the related existing facts and
 * decide per existing fact: keep (NOOP — the new fact is redundant, drop it), UPDATE (new value
 * supersedes the old — strike the old, keep the new), or DELETE (old no longer true — strike it).
 * This is what stops the "ADD-only" drift that left gbrain's supersession dead (docs/90 §4).
 *
 * Truth lives in Markdown, so "supersede" = strike the old line; the gather/decide logic here is pure
 * (no DB), the apply happens in the store. The reconcile LLM call is fail-open: on any error we fall
 * back to ADD-only so a hiccup never loses a freshly-learned fact.
 */
import type { LlmClient } from "../llm/client.js";
import type { FenceFact } from "../memory/fence.js";
import { serializeFactLine } from "../memory/fence.js";
import type { StoredFact } from "../memory/store.js";

/** Resident files whose facts are "pinned" — never auto-superseded/-deleted by reconcile (95 B-4). */
const PINNED_FILES = new Set(["MEMORY.md", "profile.md"]);
/** Max existing candidates handed to the reconcile LLM (95 B-4 cap). */
const MAX_CANDIDATES = 60;
/** Self-entities tag almost every fact, so they're useless as a gather signal — ignore them. */
const GENERIC_ENTITIES = new Set(["owner", "me", "self", "user"]);

export interface ReconcilePlan {
  /** Genuinely new facts to append. */
  add: FenceFact[];
  /** Existing facts to strike (UPDATE old half / DELETE). */
  supersede: StoredFact[];
}

/** A masked existing fact: integer id only (UUIDs/paths hidden from the model, 95 B-4). */
interface MaskedFact {
  id: number;
  fact: StoredFact;
}

/**
 * Pure: existing ACTIVE facts that share an entity with any new fact (the cheap, precise signal).
 * Pinned-file facts are still gathered for context but guarded against supersede in the parser.
 */
export function gatherRelated(newFacts: FenceFact[], existing: StoredFact[]): StoredFact[] {
  const wanted = new Set(
    newFacts.flatMap((f) => f.entities).filter((s) => !GENERIC_ENTITIES.has(s)),
  );
  if (wanted.size === 0) return [];
  const related = existing.filter(
    (e) =>
      e.state === "active" && e.entities.some((s) => !GENERIC_ENTITIES.has(s) && wanted.has(s)),
  );
  return related.slice(0, MAX_CANDIDATES);
}

export const RECONCILE_SYSTEM = `あなたは「新しい事実」と「既存の記憶」を突き合わせ、各既存記憶をどう扱うか判定する。出力は JSON のみ。
{"decisions":[{"action":"noop|update|delete","new_index":<int>,"target_id":<int>}]}
- 既存の記憶は id 付き、新しい事実は new_index(0始まり)で与えられる。
- noop: その新しい事実は既存と実質同じ → new_index を指定(新規保存しない)。
- update: 新しい事実が既存 id の「同じ属性の新しい値」で置き換える → new_index と target_id を指定(既存は取り消し線、新は保存)。
- delete: 既存 id がもう正しくない(明示的に否定された)→ target_id を指定。
- 言及しなかった新しい事実はすべて新規保存される。確信がなければ何も指定しない(=新規追加)。
- update/delete は本当に同じ対象・同じ属性のときだけ。無関係な既存を消さない。
JSON以外は出力しない。`;

export function buildReconcileUser(newFacts: FenceFact[], masked: MaskedFact[]): string {
  const news = newFacts
    .map((f, i) => `${i}: ${serializeFactLine(f).replace(/^- /, "")}`)
    .join("\n");
  const olds = masked
    .map((m) => `${m.id}: ${serializeFactLine(m.fact).replace(/^- /, "")}`)
    .join("\n");
  return `新しい事実:\n${news}\n\n既存の記憶:\n${olds}`;
}

interface RawDecision {
  action?: unknown;
  new_index?: unknown;
  target_id?: unknown;
}

/** Pure: turn the model's decisions into an apply plan. Unmentioned new facts default to ADD. */
export function parseReconcilePlan(
  raw: unknown,
  newFacts: FenceFact[],
  masked: MaskedFact[],
): ReconcilePlan {
  const decisions: unknown = (raw as { decisions?: unknown } | null)?.decisions;
  const byId = new Map(masked.map((m) => [m.id, m.fact]));
  const addIdx = new Set(newFacts.map((_, i) => i));
  const supersede: StoredFact[] = [];
  const struck = new Set<number>();
  const strike = (tid: unknown) => {
    if (!Number.isInteger(tid)) return;
    const fact = byId.get(tid as number);
    if (!fact || struck.has(tid as number)) return;
    if (PINNED_FILES.has(fact.relPath)) return; // pinned: never auto-supersede
    supersede.push(fact);
    struck.add(tid as number);
  };
  if (Array.isArray(decisions)) {
    for (const d of decisions) {
      if (typeof d !== "object" || d === null) continue;
      const { action, new_index, target_id } = d as RawDecision;
      if (action === "noop" && Number.isInteger(new_index)) addIdx.delete(new_index as number);
      else if (action === "update")
        strike(target_id); // new fact stays in addIdx (kept)
      else if (action === "delete") strike(target_id);
    }
  }
  return { add: newFacts.filter((_, i) => addIdx.has(i)), supersede };
}

/**
 * Orchestrate stage 2: gather related existing facts, ask the LLM to reconcile, return an apply plan.
 * Short-circuits to ADD-only when there's nothing related (the common case — keeps it one LLM call).
 */
export async function reconcile(
  newFacts: FenceFact[],
  existing: StoredFact[],
  llm: LlmClient,
): Promise<ReconcilePlan> {
  const candidates = gatherRelated(newFacts, existing);
  if (candidates.length === 0) return { add: newFacts, supersede: [] };
  const masked = candidates.map((fact, i) => ({ id: i + 1, fact }));
  let raw: unknown;
  try {
    raw = await llm.json(RECONCILE_SYSTEM, buildReconcileUser(newFacts, masked));
  } catch {
    return { add: newFacts, supersede: [] }; // fail-open to ADD-only — never lose a new fact
  }
  return parseReconcilePlan(raw, newFacts, masked);
}
