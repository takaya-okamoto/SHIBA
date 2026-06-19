import { describe, expect, it, vi } from "vitest";

// LIKE-mode keyword routes were never exercised in production (FTS_MODE defaulted to "fts"), which hid
// a malformed `ESCAPE '\'` clause (the backslash escaped the closing quote → SQL syntax error). These
// tests capture the SQL the provider sends so a regression in the LIKE path fails offline (no DB).

const captured: { sql: string; params: unknown[] }[] = [];
const fakePool = {
  query: async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    return [[]];
  },
};

vi.mock("../config.js", () => ({ config: { search: { ftsMode: "like" } } }));
vi.mock("../index/db.js", () => ({ getPool: () => fakePool }));
vi.mock("../index/embed.js", () => ({
  getEmbeddingProvider: () => ({ distanceExpr: () => "0", distanceParams: () => [] }),
}));

const { TidbSearchProvider } = await import("./provider.js");

describe("LIKE-mode keyword routes (FTS_MODE=like)", () => {
  it("ftsRoute emits well-formed substring SQL with a bound %query% param", async () => {
    captured.length = 0;
    await new TidbSearchProvider().ftsRoute("会食", 5);
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0] ?? { sql: "", params: [] as unknown[] };
    expect(sql).toContain("claim LIKE ?");
    expect(sql).toContain("LIMIT ?");
    expect(sql).not.toContain("ESCAPE '\\'"); // the original malformed clause
    expect(params).toEqual(["%会食%", 5]);
  });

  it("chunkFtsRoute emits well-formed substring SQL over content", async () => {
    captured.length = 0;
    await new TidbSearchProvider().chunkFtsRoute("西麻布", 3);
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0] ?? { sql: "", params: [] as unknown[] };
    expect(sql).toContain("content LIKE ?");
    expect(sql).toContain("LIMIT ?");
    expect(sql).not.toContain("ESCAPE '\\'");
    expect(params).toEqual(["%西麻布%", 3]);
  });
});
