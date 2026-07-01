import { describe, expect, it } from "vitest";
import type { SourceDoc } from "../memory/store.js";
import { buildResolver } from "./entity-resolve.js";
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

  it("collapses variant slugs into one canonical entity via the resolver", () => {
    const split: SourceDoc[] = [
      {
        relPath: "memory/2026-07-01.md",
        content: [
          "```facts v1",
          "- [event] 森社長と会食 @mori-president @tsugumi-restaurant ^2026-07-01",
          "- [event] 森社長と打ち合わせ @mori_president @tuzura ^2026-06-20",
          "- [fact] 森島氏はCEO @morishima-shacho",
          "```",
        ].join("\n"),
      },
    ];
    const resolver = buildResolver({
      entities: [
        {
          canonical: "mori-president",
          name: "森社長",
          kind: "person",
          aliases: ["morishima-shacho"],
        },
        { canonical: "tsugumi-restaurant", name: "鶫", kind: "place", aliases: ["tuzura"] },
      ],
    });
    const r = buildIndexRecords(split, resolver);
    // 3 raw spellings of the person + 2 of the place -> exactly 2 entities.
    expect(r.entities.size).toBe(2);
    const mori = r.entityRecords.find((e) => e.slug === "mori-president");
    expect(mori?.name).toBe("森社長");
    expect(mori?.kind).toBe("person");
    expect(mori?.mentionCount).toBe(3); // linked by all 3 facts
    expect(mori?.lastSeen).toBe("2026-07-01"); // max valid_from among its facts
    // only genuinely-different variants are recorded; `mori_president` folds into canonical silently
    expect(new Set(mori?.aliases)).toEqual(new Set(["morishima-shacho"]));
    // facts now carry canonical slugs only
    expect(r.facts[0]?.entitySlugs).toEqual(["mori-president", "tsugumi-restaurant"]);
    expect(r.facts[1]?.entitySlugs).toEqual(["mori-president", "tsugumi-restaurant"]);
  });
});
