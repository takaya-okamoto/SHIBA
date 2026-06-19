import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake pool that enforces the facts PRIMARY KEY the way TiDB does, so a non-truncating re-insert
// reproduces the original "Duplicate entry for key 'facts.PRIMARY'" crash (the bug that froze the
// index at the first reindex). Truncate clears the simulated table.
const factIds = new Set<unknown>();
const chunkRows: unknown[] = [];
const truncated: string[] = [];

const fakePool = {
  query: async (sql: string, params?: unknown[]) => {
    if (/^TRUNCATE TABLE (\w+)/.test(sql)) {
      const t = sql.match(/^TRUNCATE TABLE (\w+)/)?.[1];
      if (t) truncated.push(t);
      if (t === "facts") factIds.clear();
      if (t === "chunks") chunkRows.length = 0;
      return [[]];
    }
    if (/^INSERT INTO facts/.test(sql)) {
      const id = params?.[0];
      if (factIds.has(id)) {
        throw new Error(`Duplicate entry '${id}' for key 'facts.PRIMARY'`);
      }
      factIds.add(id);
      return [[]];
    }
    if (/^INSERT INTO chunks/.test(sql)) {
      chunkRows.push(params);
      return [[]];
    }
    return [[]]; // entities (ON DUPLICATE KEY UPDATE), fact_entities (INSERT IGNORE)
  },
};

vi.mock("./db.js", () => ({ getPool: () => fakePool }));

vi.mock("../memory/store.js", () => ({
  FsGitMemoryStore: class {
    async readAll() {
      return [
        {
          relPath: "memory/2026-06-14.md",
          content: ["```facts v1", "- [fact] 名前は岡本隆也である @okamoto", "```"].join("\n"),
        },
        {
          relPath: "memory/2026-06-18.md",
          content: [
            "```facts v1",
            "- [event] 7月1日19時から西麻布の鶫で森社長と会食がある @mori @tsugumi ^2026-07-01",
            "```",
          ].join("\n"),
        },
      ];
    }
  },
}));

const { reindex } = await import("./reindex.js");

describe("reindex full-rebuild idempotency", () => {
  beforeEach(() => {
    factIds.clear();
    chunkRows.length = 0;
    truncated.length = 0;
  });

  it("re-running does not crash on the facts PRIMARY KEY (the original freeze bug)", async () => {
    await reindex(); // first flush
    await expect(reindex()).resolves.toBeUndefined(); // second flush must NOT throw
    expect(factIds.size).toBe(2); // exactly the two markdown facts — not doubled, not stale
  });

  it("always truncates (full rebuild) even without opts.all", async () => {
    await reindex();
    expect(truncated).toEqual(["fact_entities", "facts", "chunks", "entities"]);
  });

  it("opts.all is accepted but behaves identically (full rebuild)", async () => {
    await reindex({ all: true });
    const afterAll = [...truncated];
    truncated.length = 0;
    factIds.clear();
    await reindex({ all: false });
    expect(truncated).toEqual(afterAll); // same truncate set regardless of the flag
  });
});
