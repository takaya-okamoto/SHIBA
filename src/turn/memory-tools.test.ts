import { describe, expect, it } from "vitest";
import type { StoredFact } from "../memory/store.js";
import { buildRememberFact, matchForget, targetsOf } from "./memory-tools.js";

const stored = (claim: string, over: Partial<StoredFact> = {}): StoredFact => ({
  claim,
  kind: "fact",
  entities: [],
  validFrom: null,
  sourceTrust: "owner",
  state: "active",
  relPath: "MEMORY.md",
  ...over,
});

describe("buildRememberFact", () => {
  it("builds an owner-trusted fact, defaulting kind and filtering bad slugs", () => {
    const f = buildRememberFact({
      claim: "紅茶派になった",
      kind: "preference",
      entities: ["tea", "BAD"],
    });
    expect(f).toEqual({
      claim: "紅茶派になった",
      kind: "preference",
      entities: ["tea"],
      validFrom: null,
      sourceTrust: "owner",
      state: "active",
    });
  });

  it("defaults an unknown kind to fact", () => {
    expect(buildRememberFact({ claim: "x", kind: "bogus" })?.kind).toBe("fact");
  });

  it("scrubs secrets and returns null for empty input", () => {
    expect(buildRememberFact({ claim: "鍵は sk-abcdefghijklmnop1234" })?.claim).toBe(
      "鍵は [REDACTED]",
    );
    expect(buildRememberFact({ claim: "   " })).toBeNull();
    expect(buildRememberFact({})).toBeNull();
  });
});

describe("matchForget", () => {
  const facts = [
    stored("コーヒーはブラックが好き"),
    stored("猫を飼っている"),
    stored("古い好み", { state: "superseded" }),
  ];

  it("matches active facts either-way by substring", () => {
    expect(matchForget(facts, "コーヒー").map((f) => f.claim)).toEqual([
      "コーヒーはブラックが好き",
    ]);
    expect(matchForget(facts, "猫を飼っているという事実").map((f) => f.claim)).toEqual([
      "猫を飼っている",
    ]);
  });

  it("ignores superseded facts and empty queries", () => {
    expect(matchForget(facts, "古い好み")).toEqual([]); // already superseded
    expect(matchForget(facts, "  ")).toEqual([]);
  });

  it("caps the number of matches", () => {
    const many = Array.from({ length: 10 }, (_, i) => stored(`好み${i}を含む話`));
    expect(matchForget(many, "好み", 3)).toHaveLength(3);
  });
});

describe("targetsOf", () => {
  it("maps facts to {relPath, claim} supersede targets", () => {
    expect(targetsOf([stored("a", { relPath: "memory/x.md" })])).toEqual([
      { relPath: "memory/x.md", claim: "a" },
    ]);
  });
});
