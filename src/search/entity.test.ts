import { describe, expect, it } from "vitest";
import { type EntityCandidate, rankEntities } from "./entity.js";

const e = (
  id: string,
  slug: string,
  name: string,
  over: Partial<EntityCandidate> = {},
): EntityCandidate => ({
  id,
  slug,
  name,
  ...over,
});

describe("rankEntities", () => {
  const entities = [
    e("1", "tanaka", "田中", { mentionCount: 10 }),
    e("2", "coffee", "コーヒー", { aliases: ["珈琲"], mentionCount: 5 }),
    e("3", "a-corp", "A社", { mentionCount: 1 }),
  ];

  it("matches a Japanese name substring", () => {
    expect(rankEntities("田中さんとの打ち合わせ", entities)).toEqual(["1"]);
  });

  it("matches an ascii slug as a token", () => {
    expect(rankEntities("notes about coffee today", entities)).toEqual(["2"]);
  });

  it("matches an alias", () => {
    expect(rankEntities("珈琲が好き", entities)).toEqual(["2"]);
  });

  it("returns nothing when the query references no known entity (confidence gate)", () => {
    expect(rankEntities("今日はいい天気", entities)).toEqual([]);
  });

  it("ranks exact-slug over name-substring and breaks ties on mention_count", () => {
    const set = [
      e("low", "topic", "話題", { mentionCount: 1 }),
      e("high", "topic2", "話題", { mentionCount: 99 }),
    ];
    // both names "話題" substring-match; higher mention_count wins the tie
    expect(rankEntities("話題について", set)[0]).toBe("high");
  });

  it("caps the number of resolved entities", () => {
    const many = Array.from({ length: 6 }, (_, i) => e(String(i), `s${i}`, `名前${i}`));
    expect(rankEntities("名前0 名前1 名前2 名前3", many, 2)).toHaveLength(2);
  });
});
