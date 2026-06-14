import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./chunk.js";

describe("chunkMarkdown", () => {
  it("sections by heading, paragraphs by blank line, drops fences", () => {
    const md = ["# Day", "para one.", "", "para two.", "", "```facts v1", "- [fact] x", "```"].join(
      "\n",
    );
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.content)).toEqual(["para one.", "para two."]);
    expect(chunks[0]?.heading).toBe("Day");
  });
  it("splits long paragraphs on sentence enders, capped length", () => {
    const chunks = chunkMarkdown("あ。".repeat(400)); // 800 chars, no blank lines
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 500)).toBe(true);
  });
});
