import { describe, expect, it } from "vitest";
import { type MetaRow, compareMeta } from "./meta.js";

const base: MetaRow = {
  schemaVersion: 1,
  embeddingProvider: "tidb-auto",
  embeddingModel: "titan-v2",
  embeddingDim: 1024,
};

describe("compareMeta", () => {
  it("treats a missing meta row as a fresh index (ok)", () => {
    expect(compareMeta(null, base).ok).toBe(true);
  });

  it("matches identical config", () => {
    expect(compareMeta(base, base)).toMatchObject({
      ok: true,
      schemaMismatch: false,
      embeddingMismatch: false,
    });
  });

  it("flags a schema mismatch as fatal", () => {
    const c = compareMeta({ ...base, schemaVersion: 0 }, base);
    expect(c.schemaMismatch).toBe(true);
    expect(c.ok).toBe(false);
  });

  it("flags an embedding model or dim change", () => {
    expect(compareMeta({ ...base, embeddingModel: "gemini" }, base).embeddingMismatch).toBe(true);
    expect(compareMeta({ ...base, embeddingDim: 1536 }, base).embeddingMismatch).toBe(true);
    expect(compareMeta({ ...base, embeddingDim: 1536 }, base).ok).toBe(false);
  });
});
