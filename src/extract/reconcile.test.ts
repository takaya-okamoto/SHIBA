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

  it("gathers nothing for short claims with no entity overlap", () => {
    expect(gatherRelated([fact("何か", [])], [stored("既存", ["x"], "a.md")])).toEqual([]);
  });

  it("gathers a re-stated duplicate even when entity slugs drift (bigram similarity)", () => {
    // The real bug: the same dinner got extracted 3× with different slugs, so the entity-only gather
    // never compared them. Similarity must bridge mori-president / mori_president / morishima-shacho.
    const news = [
      fact(
        "森社長と東大教授が2026年7月1日19時に関わる会合がある",
        ["mori_president", "todai_prof"],
        {
          kind: "event",
        },
      ),
    ];
    const existing = [
      stored(
        "7月1日19時から西麻布の鶫で森社長と東大教授との会食の予定がある",
        ["mori-president", "tsugumi-restaurant"], // NOTE: zero slug overlap with the new fact
        "memory/2026-06-18.md",
        { kind: "event" },
      ),
      stored("名前は岡本隆也である", ["okamoto"], "memory/2026-06-14.md", { kind: "fact" }),
    ];
    const got = gatherRelated(news, existing);
    // the dinner is gathered (via similarity); the unrelated name fact is not
    expect(got.map((f) => f.claim)).toEqual([
      "7月1日19時から西麻布の鶫で森社長と東大教授との会食の予定がある",
    ]);
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
