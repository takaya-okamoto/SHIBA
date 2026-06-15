import { describe, expect, it } from "vitest";
import type { FactKind, SearchHit } from "../types.js";
import type { RouteHit } from "./provider.js";
import {
  type RankedList,
  autocut,
  demoteUntrusted,
  recencyBoost,
  rescueFromFts,
  rrfFuse,
} from "./rrf.js";

describe("rescueFromFts", () => {
  it("dedups by id, demotes untrusted, and caps to the limit", () => {
    const fts: RouteHit[] = [
      { id: "a", claim: "trusted", sourceTrust: "owner" },
      { id: "a", claim: "dup", sourceTrust: "owner" },
      { id: "b", claim: "untrusted", sourceTrust: "untrusted" },
    ];
    const out = rescueFromFts(fts, 5);
    expect(out.map((h) => h.id)).toEqual(["a", "b"]); // dedup + trusted first
    expect(rescueFromFts(fts, 1)).toHaveLength(1);
  });
});

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

describe("recencyBoost", () => {
  const now = Date.parse("2026-06-14T00:00:00Z");
  const mk = (
    id: string,
    kind: FactKind | undefined,
    score: number,
    daysAgo: number | null,
  ): SearchHit => ({
    id,
    claim: id,
    sourceTrust: "owner",
    score,
    routes: ["vector"],
    kind,
    recordedAt: daysAgo === null ? undefined : new Date(now - daysAgo * 86_400_000).toISOString(),
  });

  it("halves a dated fact at one half-life; leaves evergreen kinds untouched", () => {
    const out = recencyBoost([mk("ev", "preference", 1, 30), mk("dated", "event", 1, 30)], now, 30);
    expect(out.find((h) => h.id === "ev")?.score).toBe(1); // preference is evergreen -> exempt
    expect(out.find((h) => h.id === "dated")?.score).toBeCloseTo(0.5, 5); // 30d == half-life
  });

  it("decays older dated facts more and re-sorts by score", () => {
    const out = recencyBoost(
      [mk("old", "commitment", 1, 60), mk("new", "commitment", 1, 0)],
      now,
      30,
    );
    expect(out[0]?.id).toBe("new"); // recent ranks first after decay
    expect(out.find((h) => h.id === "old")?.score).toBeCloseTo(0.25, 5); // 60d == 2 half-lives
  });

  it("leaves hits without recorded_at or kind untouched", () => {
    expect(recencyBoost([mk("x", undefined, 1, null)], now, 30)[0]?.score).toBe(1);
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
