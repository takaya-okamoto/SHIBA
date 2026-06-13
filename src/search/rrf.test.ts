import { describe, expect, it } from "vitest";
import type { SearchHit } from "../types.js";
import { autocut, demoteUntrusted, type RankedList, rrfFuse } from "./rrf.js";

describe("rrfFuse", () => {
  it("rewards items that appear in multiple routes", () => {
    const lists: RankedList[] = [
      {
        route: "vector",
        hits: [
          { id: "a", claim: "a", sourceTrust: "owner" },
          { id: "b", claim: "b", sourceTrust: "owner" },
        ],
      },
      {
        route: "fts",
        hits: [
          { id: "b", claim: "b", sourceTrust: "owner" },
          { id: "c", claim: "c", sourceTrust: "owner" },
        ],
      },
    ];
    const fused = rrfFuse(lists, 60);
    expect(fused[0]?.id).toBe("b"); // present in both routes
    expect(fused.find((h) => h.id === "b")?.routes).toEqual(["vector", "fts"]);
  });
});

describe("demoteUntrusted", () => {
  it("ranks trusted above untrusted near-ties (98 §3.5)", () => {
    const hits: SearchHit[] = [
      { id: "u", claim: "u", sourceTrust: "untrusted", score: 1, routes: ["vector"] },
      { id: "o", claim: "o", sourceTrust: "owner", score: 0.9, routes: ["vector"] },
    ];
    expect(demoteUntrusted(hits)[0]?.id).toBe("o");
  });
});

describe("autocut", () => {
  it("cuts at the largest score gap", () => {
    const hits: SearchHit[] = [
      { id: "1", claim: "", sourceTrust: "owner", score: 1.0, routes: [] },
      { id: "2", claim: "", sourceTrust: "owner", score: 0.95, routes: [] },
      { id: "3", claim: "", sourceTrust: "owner", score: 0.2, routes: [] },
    ];
    expect(autocut(hits, 10).map((h) => h.id)).toEqual(["1", "2"]);
  });
});
