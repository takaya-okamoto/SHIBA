import { describe, expect, it } from "vitest";
import type { LlmClient } from "../llm/client.js";
import { buildNudgeUser, parseNudge, proactiveNudge } from "./nudge.js";

describe("parseNudge", () => {
  it("reads {note} and trims it", () => {
    expect(parseNudge({ note: "  手土産の準備はいい感じ?  " })).toBe("手土産の準備はいい感じ?");
  });
  it("returns empty for missing/garbage (never throws)", () => {
    expect(parseNudge({})).toBe("");
    expect(parseNudge(null)).toBe("");
    expect(parseNudge({ note: 1 })).toBe("");
  });
});

describe("buildNudgeUser", () => {
  it("anchors today and numbers the facts", () => {
    const u = buildNudgeUser(["事実A", "事実B"], "2026-06-25");
    expect(u).toContain("今日 = 2026-06-25");
    expect(u).toContain("1. 事実A");
    expect(u).toContain("2. 事実B");
  });
});

describe("proactiveNudge", () => {
  const llm = (over: Partial<LlmClient> = {}): LlmClient => ({
    respond: async () => "",
    json: async () => ({ note: "会食まであと6日、店の場所は西麻布だよ。" }),
    ...over,
  });

  it("returns the model's note", async () => {
    expect(await proactiveNudge(["会食 7/1"], llm(), "2026-06-25")).toBe(
      "会食まであと6日、店の場所は西麻布だよ。",
    );
  });
  it("returns empty when there are no facts (skips the call)", async () => {
    expect(await proactiveNudge([], llm())).toBe("");
  });
  it("fails open to empty on model error", async () => {
    const bad = llm({
      json: async () => {
        throw new Error("down");
      },
    });
    expect(await proactiveNudge(["x"], bad)).toBe("");
  });
});
