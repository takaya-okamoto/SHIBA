import { describe, expect, it } from "vitest";
import type { FenceFact } from "../memory/fence.js";
import type { StoredFact } from "../memory/store.js";
import { gatherRelated, parseReconcilePlan } from "./reconcile.js";

const fact = (claim: string, entities: string[], over: Partial<FenceFact> = {}): FenceFact => ({
  claim,
  kind: "preference",
  entities,
  validFrom: null,
  sourceTrust: "owner",
  state: "active",
  ...over,
});
const stored = (
  claim: string,
  entities: string[],
  relPath: string,
  over: Partial<StoredFact> = {},
): StoredFact => ({
  ...fact(claim, entities, over),
  relPath,
});

const masked = (facts: StoredFact[]) => facts.map((f, i) => ({ id: i + 1, fact: f }));

describe("gatherRelated", () => {
  it("returns active existing facts that share an entity with a new fact", () => {
    const news = [fact("コーヒーは紅茶に変えた", ["owner", "coffee"])];
    const existing = [
      stored("コーヒーはブラックが好き", ["owner", "coffee"], "memory/2026-01-01.md"),
      stored("猫を飼っている", ["owner", "cat"], "memory/2026-01-01.md"),
      stored("古いコーヒーの話", ["coffee"], "memory/old.md", { state: "superseded" }),
    ];
    const got = gatherRelated(news, existing);
    expect(got.map((f) => f.claim)).toEqual(["コーヒーはブラックが好き"]); // shares coffee, active only
  });

  it("returns nothing when the new facts have no entities", () => {
    expect(gatherRelated([fact("何か", [])], [stored("既存", ["x"], "a.md")])).toEqual([]);
  });
});

describe("parseReconcilePlan", () => {
  const news = [fact("コーヒーは紅茶に変えた", ["owner", "coffee"])];
  const cand = [stored("コーヒーはブラックが好き", ["owner", "coffee"], "memory/2026-01-01.md")];

  it("UPDATE keeps the new fact and supersedes the targeted old one", () => {
    const plan = parseReconcilePlan(
      { decisions: [{ action: "update", new_index: 0, target_id: 1 }] },
      news,
      masked(cand),
    );
    expect(plan.add.map((f) => f.claim)).toEqual(["コーヒーは紅茶に変えた"]);
    expect(plan.supersede.map((f) => f.claim)).toEqual(["コーヒーはブラックが好き"]);
  });

  it("NOOP drops the redundant new fact", () => {
    const plan = parseReconcilePlan(
      { decisions: [{ action: "noop", new_index: 0 }] },
      news,
      masked(cand),
    );
    expect(plan.add).toEqual([]);
    expect(plan.supersede).toEqual([]);
  });

  it("DELETE supersedes the old fact and adds nothing extra", () => {
    const plan = parseReconcilePlan(
      { decisions: [{ action: "delete", target_id: 1 }] },
      [],
      masked(cand),
    );
    expect(plan.add).toEqual([]);
    expect(plan.supersede.map((f) => f.claim)).toEqual(["コーヒーはブラックが好き"]);
  });

  it("never auto-supersedes a pinned (MEMORY.md / profile.md) fact", () => {
    const pinned = [stored("名前はオーナー", ["owner"], "MEMORY.md")];
    const plan = parseReconcilePlan(
      { decisions: [{ action: "delete", target_id: 1 }] },
      [],
      masked(pinned),
    );
    expect(plan.supersede).toEqual([]);
  });

  it("defaults unmentioned new facts to ADD and ignores bad target ids", () => {
    const two = [fact("a", ["owner"]), fact("b", ["owner"])];
    const plan = parseReconcilePlan(
      { decisions: [{ action: "delete", target_id: 999 }] },
      two,
      masked(cand),
    );
    expect(plan.add.map((f) => f.claim)).toEqual(["a", "b"]);
    expect(plan.supersede).toEqual([]);
  });

  it("treats garbage output as ADD-all (never loses new facts)", () => {
    expect(parseReconcilePlan("nope", news, masked(cand)).add).toHaveLength(1);
    expect(parseReconcilePlan(null, news, masked(cand)).supersede).toEqual([]);
  });
});
