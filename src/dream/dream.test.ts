import { describe, expect, it } from "vitest";
import { shouldRunDaily } from "../digest/scheduler.js";
import type { LlmClient } from "../llm/client.js";
import {
  type ReconcileSource,
  buildReconcilePrompt,
  parseInsights,
  reconcile,
} from "./reconcile.js";

const fakeLlm = (json: unknown): LlmClient => ({
  respond: async () => "",
  json: async () => json,
});

describe("parseInsights", () => {
  it("extracts up to 3 non-empty strings", () => {
    expect(parseInsights({ insights: ["a", "b", "", "c", "d"] })).toEqual(["a", "b", "c"]);
  });
  it("returns [] for malformed output", () => {
    expect(parseInsights({})).toEqual([]);
    expect(parseInsights("nope")).toEqual([]);
    expect(parseInsights({ insights: "x" })).toEqual([]);
  });
});

describe("reconcile", () => {
  const source = (
    facts: { claim: string; kind: string; recordedAt: string }[],
  ): ReconcileSource => ({ activeFacts: async () => facts });

  it("returns [] when there are fewer than 2 facts (nothing to reconcile)", async () => {
    const llm = fakeLlm({ insights: ["should not be used"] });
    expect(await reconcile(source([{ claim: "x", kind: "fact", recordedAt: "" }]), llm)).toEqual(
      [],
    );
  });

  it("returns the model's insights when facts conflict", async () => {
    const facts = [
      { claim: "好きな色は青", kind: "preference", recordedAt: "2026-06-01T00:00:00Z" },
      { claim: "好きな色は緑", kind: "preference", recordedAt: "2026-06-14T00:00:00Z" },
    ];
    const llm = fakeLlm({ insights: ["『好きな色』が青と緑で食い違っています"] });
    expect(await reconcile(source(facts), llm)).toEqual(["『好きな色』が青と緑で食い違っています"]);
  });
});

describe("buildReconcilePrompt", () => {
  it("numbers facts with kind and date", () => {
    const p = buildReconcilePrompt([
      { claim: "歯医者", kind: "commitment", recordedAt: "2026-06-14T09:00:00Z" },
    ]);
    expect(p).toBe("1. [commitment] 歯医者（2026-06-14）");
  });
});

describe("shouldRunDaily", () => {
  const tz = 540; // JST
  it("runs once at/after the hour, not twice the same local day", () => {
    const at = Date.parse("2026-06-14T18:30:00Z"); // 03:30 JST Jun 15
    expect(shouldRunDaily(at, null, 3, tz)).toBe(true);
    expect(shouldRunDaily(at, "2026-06-15", 3, tz)).toBe(false);
  });
  it("does not run before the hour", () => {
    expect(shouldRunDaily(Date.parse("2026-06-14T16:00:00Z"), null, 3, tz)).toBe(false); // 01:00 JST
  });
});
