import { describe, expect, it, vi } from "vitest";
import { search } from "./hybrid.js";
import type { RouteHit, SearchProvider } from "./provider.js";

const hit = (id: string, claim: string, over: Partial<RouteHit> = {}): RouteHit => ({
  id,
  claim,
  sourceTrust: "owner",
  ...over,
});

/** Fake provider so the orchestration is unit-testable without TiDB. */
function fakeProvider(over: Partial<SearchProvider> = {}): SearchProvider {
  return {
    vectorRoute: vi.fn(async () => []),
    ftsRoute: vi.fn(async () => []),
    entityRoute: vi.fn(async () => []),
    chunkVectorRoute: vi.fn(async () => []),
    chunkFtsRoute: vi.fn(async () => []),
    ...over,
  };
}

describe("search (hybrid orchestration)", () => {
  it("queries fact AND chunk routes", async () => {
    const p = fakeProvider({
      vectorRoute: vi.fn(async () => [hit("1", "fact vec")]),
      chunkVectorRoute: vi.fn(async () => [hit("c:9", "chunk vec")]),
    });
    const hits = await search("q", { entityIds: [] }, p);
    expect(p.chunkVectorRoute).toHaveBeenCalledOnce();
    expect(hits.map((h) => h.id).sort()).toEqual(["1", "c:9"]);
  });

  it("skips the entity-route when nothing resolves, runs it when ids are given", async () => {
    const entityRoute = vi.fn(async () => [hit("e1", "entity hit")]);
    const p = fakeProvider({ entityRoute });
    await search("q", { entityIds: [] }, p);
    expect(entityRoute).not.toHaveBeenCalled();
    await search("q", { entityIds: ["42"] }, p);
    expect(entityRoute).toHaveBeenCalledWith("42", "q", expect.any(Number));
  });

  it("is fail-open: a throwing route degrades to [] instead of killing recall", async () => {
    const p = fakeProvider({
      vectorRoute: vi.fn(async () => {
        throw new Error("embedding down");
      }),
      ftsRoute: vi.fn(async () => [hit("k1", "keyword only")]),
    });
    const hits = await search("q", { entityIds: [] }, p);
    expect(hits.map((h) => h.id)).toContain("k1"); // FTS still surfaces despite vector failure
  });
});
