import { describe, expect, it } from "vitest";
import { type FenceFact, parseFactLine, parseFacts, serializeFactsBlock } from "./fence.js";

describe("parseFactLine", () => {
  it("parses kind, claim, entities, valid_from", () => {
    const f = parseFactLine("- [event] 田中さんとA社の打ち合わせ @tanaka @a-corp ^2026-06-10");
    expect(f).toMatchObject({
      kind: "event",
      entities: ["tanaka", "a-corp"],
      validFrom: "2026-06-10",
      sourceTrust: "owner",
      state: "active",
    });
    expect(f?.claim).toBe("田中さんとA社の打ち合わせ");
  });
  it("marks untrusted and strikethrough", () => {
    expect(parseFactLine("- [fact] x !untrusted")?.sourceTrust).toBe("untrusted");
    expect(parseFactLine("- ~~[fact] 以前はB社~~ @b-corp")?.state).toBe("superseded");
  });
  it("rejects non-fact lines and unknown kinds", () => {
    expect(parseFactLine("just text")).toBeNull();
    expect(parseFactLine("- [bogus] x")).toBeNull();
  });
});

describe("parseFacts", () => {
  it("only reads inside ```facts blocks", () => {
    const md = [
      "intro",
      "```facts v1",
      "- [preference] coffee @owner",
      "```",
      "- [event] ignored",
    ].join("\n");
    const facts = parseFacts(md);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe("preference");
  });
});

describe("round-trip", () => {
  it("serialize -> parse is stable", () => {
    const facts: FenceFact[] = [
      {
        claim: "コーヒーはブラック",
        kind: "preference",
        entities: ["owner"],
        validFrom: null,
        sourceTrust: "owner",
        state: "active",
      },
      {
        claim: "以前はB社勤務",
        kind: "fact",
        entities: ["b-corp"],
        validFrom: "2024-01-01",
        sourceTrust: "untrusted",
        state: "superseded",
      },
    ];
    expect(parseFacts(serializeFactsBlock(facts))).toEqual(facts);
  });
});
