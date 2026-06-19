import { describe, expect, it } from "vitest";
import { CorpusProvider, routeProvider } from "./providers.js";
import { assertCase, parseSuite, runCase } from "./runner.js";
import type { EvalCase, Suite } from "./types.js";

describe("parseSuite", () => {
  it("parses a valid routes suite and defaults mode", () => {
    const s = parseSuite("suite: t\ncases:\n  - name: c1\n    query: q\n    contains: [x]\n");
    expect(s.mode).toBe("routes");
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0]?.name).toBe("c1");
  });

  it("rejects a missing suite name / empty cases / bad mode", () => {
    expect(() => parseSuite("cases: []")).toThrow(/suite/);
    expect(() => parseSuite("suite: t\ncases: []")).toThrow(/no cases/);
    expect(() =>
      parseSuite("suite: t\nmode: nope\ncases:\n  - name: a\n    query: q\n    first: a"),
    ).toThrow(/bad mode/);
  });

  it("rejects a case with no query or no assertion", () => {
    expect(() => parseSuite("suite: t\ncases:\n  - name: a\n    contains: [x]")).toThrow(/query/);
    expect(() => parseSuite("suite: t\ncases:\n  - name: a\n    query: q")).toThrow(
      /no expectation/,
    );
  });

  it("requires corpus when mode is corpus", () => {
    expect(() =>
      parseSuite("suite: t\nmode: corpus\ncases:\n  - name: a\n    query: q\n    first: a"),
    ).toThrow(/corpus mode needs/);
  });
});

describe("assertCase", () => {
  const c: EvalCase = {
    name: "x",
    query: "q",
    topK: ["a", "b"],
    contains: ["a"],
    excludes: ["z"],
    order: ["a", "b"],
    first: "a",
    count: { min: 2, max: 2 },
  };
  it("passes when every expectation holds", () => {
    expect(assertCase(c, ["a", "b"])).toEqual([]);
  });
  it("flags topK/order/contains/excludes/count violations", () => {
    expect(assertCase({ name: "x", query: "q", topK: ["a", "b"] }, ["b", "a"])).toHaveLength(1);
    expect(assertCase({ name: "x", query: "q", order: ["a", "b"] }, ["b", "a"])[0]).toMatch(
      /order/,
    );
    expect(assertCase({ name: "x", query: "q", contains: ["a"] }, ["b"])[0]).toMatch(/missing/);
    expect(assertCase({ name: "x", query: "q", excludes: ["z"] }, ["z"])[0]).toMatch(/exclude/);
    expect(assertCase({ name: "x", query: "q", count: { max: 1 } }, ["a", "b"])[0]).toMatch(
      /count/,
    );
  });
});

describe("routeProvider", () => {
  it("replays the declared hits per route with defaults", async () => {
    const p = routeProvider({ fts: [{ id: "1", claim: "hi" }] });
    const fts = await p.ftsRoute("q", 10);
    expect(fts).toHaveLength(1);
    expect(fts[0]).toMatchObject({ id: "1", claim: "hi", sourceTrust: "owner" });
    expect(await p.vectorRoute("q", 10)).toEqual([]);
  });
});

describe("CorpusProvider", () => {
  const p = new CorpusProvider({
    facts: [
      { id: "f1", claim: "毎週火曜はゴミの日" },
      { id: "f2", claim: "コーヒー好き", entities: ["e1"] },
    ],
    chunks: [{ id: "ch1", content: "京都memo" }],
  });
  it("matches facts by CJK substring and leaves vector empty", async () => {
    expect((await p.ftsRoute("ゴミ", 10)).map((h) => h.id)).toEqual(["f1"]);
    expect(await p.vectorRoute()).toEqual([]);
  });
  it("namespaces chunk ids with c:", async () => {
    expect((await p.chunkFtsRoute("memo", 10)).map((h) => h.id)).toEqual(["c:ch1"]);
  });
  it("entity route surfaces linked facts", async () => {
    expect((await p.entityRoute("e1", "q", 10)).map((h) => h.id)).toEqual(["f2"]);
    expect(await p.entityRoute("absent", "q", 10)).toEqual([]);
  });
});

describe("runCase (end-to-end through real search)", () => {
  const suite: Suite = { suite: "t", mode: "routes", cases: [] };
  it("reports a pass with the actual ids", async () => {
    const res = await runCase(suite, {
      name: "k",
      query: "q",
      routes: { vector: [{ id: "v", claim: "v" }], fts: [{ id: "k", claim: "k" }] },
      contains: ["k"],
      count: { min: 2 },
    });
    expect(res.passed).toBe(true);
    expect(res.got.sort()).toEqual(["k", "v"]);
  });
  it("reports a failure with the offending assertion", async () => {
    const res = await runCase(suite, {
      name: "bad",
      query: "q",
      routes: { fts: [{ id: "only", claim: "only" }] },
      contains: ["missing"],
    });
    expect(res.passed).toBe(false);
    expect(res.failures[0]).toMatch(/missing/);
  });
});
