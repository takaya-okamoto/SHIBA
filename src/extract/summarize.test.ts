import { describe, expect, it } from "vitest";
import { buildSummaryUser, parseSummary, summarizeTranscript } from "./summarize.js";

describe("parseSummary", () => {
  it("reads {summary} and returns the trimmed prose", () => {
    expect(parseSummary({ summary: "  森社長と受託方針を相談した。  " })).toBe(
      "森社長と受託方針を相談した。",
    );
  });

  it("returns empty string for missing/garbage output (never throws)", () => {
    expect(parseSummary({})).toBe("");
    expect(parseSummary(null)).toBe("");
    expect(parseSummary("nope")).toBe("");
    expect(parseSummary({ summary: 42 })).toBe("");
  });

  it("scrubs secrets from the summary (it is stored + re-injected)", () => {
    const out = parseSummary({ summary: "鍵は sk-ABCDEF1234567890 を設定した" });
    expect(out).not.toContain("sk-ABCDEF1234567890");
  });
});

describe("buildSummaryUser", () => {
  it("wraps the transcript as untrusted data and anchors the date outside it", () => {
    const u = buildSummaryUser("会話本文", "2026-06-19");
    expect(u).toContain("観測日");
    expect(u).toContain("2026-06-19");
    expect(u).toContain("<untrusted_input>\n会話本文\n</untrusted_input>");
  });
});

describe("summarizeTranscript", () => {
  it("fails open to empty string when the model call throws (never breaks a flush)", async () => {
    const llm = {
      respond: async () => "",
      json: async () => {
        throw new Error("model down");
      },
    };
    expect(await summarizeTranscript("text", llm)).toBe("");
  });

  it("returns the parsed summary on success", async () => {
    const llm = {
      respond: async () => "",
      json: async () => ({ summary: "要約" }),
    };
    expect(await summarizeTranscript("text", llm)).toBe("要約");
  });
});
