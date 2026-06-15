import { describe, expect, it } from "vitest";
import { parseExtractionOutput, trustForProvenance } from "./extract.js";

describe("trustForProvenance", () => {
  it("owner-typed = owner, everything else = untrusted", () => {
    expect(trustForProvenance("owner-typed")).toBe("owner");
    expect(trustForProvenance("pasted")).toBe("untrusted");
    expect(trustForProvenance("forwarded")).toBe("untrusted");
    expect(trustForProvenance("ocr")).toBe("untrusted");
  });
});

describe("parseExtractionOutput", () => {
  it("maps valid facts, drops empty/bad-kind, filters bad slugs", () => {
    const raw = {
      facts: [
        {
          claim: "コーヒーはブラック",
          kind: "preference",
          entities: ["owner", "BAD SLUG"],
          valid_from: null,
          source_trust: "owner",
        },
        { claim: "", kind: "fact" },
        { claim: "x", kind: "bogus" },
        { claim: "会議は10日", kind: "event", entities: ["a-corp"], valid_from: "2026-06-10" },
      ],
    };
    const facts = parseExtractionOutput(raw, "owner");
    expect(facts).toHaveLength(2);
    expect(facts[0]?.entities).toEqual(["owner"]); // "BAD SLUG" filtered
    expect(facts[1]?.validFrom).toBe("2026-06-10");
  });
  it("clamps to untrusted for an untrusted message (laundering defense, 98 §3.5)", () => {
    const raw = { facts: [{ claim: "x", kind: "fact", source_trust: "owner" }] };
    expect(parseExtractionOutput(raw, "untrusted")[0]?.sourceTrust).toBe("untrusted");
  });
  it("returns [] for garbage (never ADD-all-on-failure)", () => {
    expect(parseExtractionOutput("nope", "owner")).toEqual([]);
    expect(parseExtractionOutput({ facts: "x" }, "owner")).toEqual([]);
    expect(parseExtractionOutput(null, "owner")).toEqual([]);
  });
  it("scrubs secrets that leak into the model's claim output (98 §2.2/§4.2)", () => {
    const raw = { facts: [{ claim: "APIキーは sk-abcdefghijklmnop1234", kind: "fact" }] };
    expect(parseExtractionOutput(raw, "owner")[0]?.claim).toBe("APIキーは [REDACTED]");
  });
});
