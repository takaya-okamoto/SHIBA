import { describe, expect, it } from "vitest";
import type { SourceDoc } from "../memory/store.js";
import { buildIndexRecords } from "./reindex.js";

describe("buildIndexRecords", () => {
  const docs: SourceDoc[] = [
    {
      relPath: "memory/2026-06-13.md",
      content: [
        "# 2026-06-13",
        "渋谷でランチした。",
        "",
        "```facts v1",
        "- [event] 田中さんとA社の打ち合わせ @tanaka @a-corp ^2026-06-10",
        "- [preference] コーヒーはブラック @owner",
        "```",
      ].join("\n"),
    },
  ];

  it("derives chunks, facts, entities and materializes links", () => {
    const r = buildIndexRecords(docs);
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0]?.content).toBe("渋谷でランチした。");
    expect(r.facts).toHaveLength(2);
    expect(r.entities.size).toBe(3); // tanaka, a-corp, owner
    const ev = r.facts.find((f) => f.kind === "event");
    expect(ev?.entitySlugs).toEqual(["tanaka", "a-corp"]);
    expect(ev?.validFrom).toBe("2026-06-10");
    expect(new Set(r.facts.map((f) => f.id)).size).toBe(2); // unique ids
  });
});
