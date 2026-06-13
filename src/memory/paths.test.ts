import { describe, expect, it } from "vitest";
import { isValidSlug, safeJoin } from "./paths.js";

describe("safeJoin", () => {
  it("joins within the root", () => {
    expect(safeJoin("/m", "memory/a.md")).toBe("/m/memory/a.md");
  });
  it("rejects traversal / absolute / home / null byte", () => {
    expect(() => safeJoin("/m", "../etc/passwd")).toThrow();
    expect(() => safeJoin("/m", "/etc/passwd")).toThrow();
    expect(() => safeJoin("/m", "~/x")).toThrow();
    expect(() => safeJoin("/m", "a\0b")).toThrow();
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase slugs, rejects spaces / caps / CJK", () => {
    expect(isValidSlug("a-corp_1")).toBe(true);
    expect(isValidSlug("A Corp")).toBe(false);
    expect(isValidSlug("田中")).toBe(false);
  });
});
