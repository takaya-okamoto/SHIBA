import { describe, expect, it } from "vitest";
import { queryHash } from "./st.js";

describe("queryHash", () => {
  it("is a stable 64-char sha256 hex (never the query body — 98 §4.3)", () => {
    const h = queryHash("田中さんとの打ち合わせ");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(queryHash("田中さんとの打ち合わせ")).toBe(h); // stable
    expect(queryHash("別のクエリ")).not.toBe(h);
  });
});
