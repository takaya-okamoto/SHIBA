import { describe, expect, it } from "vitest";
import { type AliasConfig, buildResolver, canonicalizeSlug } from "./entity-resolve.js";

describe("canonicalizeSlug", () => {
  it("merges underscore / hyphen / case variants", () => {
    expect(canonicalizeSlug("mori_president")).toBe("mori-president");
    expect(canonicalizeSlug("Mori-President")).toBe("mori-president");
    expect(canonicalizeSlug("okamoto_takaya")).toBe("okamoto-takaya");
    expect(canonicalizeSlug("okamoto-takaya")).toBe("okamoto-takaya");
  });
  it("collapses repeats and trims separators", () => {
    expect(canonicalizeSlug("__a__b__")).toBe("a-b");
    expect(canonicalizeSlug("a  b")).toBe("a-b");
  });
});

describe("buildResolver", () => {
  const cfg: AliasConfig = {
    entities: [
      {
        canonical: "okamoto-takaya",
        name: "岡本隆也",
        kind: "person",
        aliases: ["owner", "okamoto_takaya"],
      },
      { canonical: "tsugumi-restaurant", name: "鶫", kind: "place", aliases: ["tuzura"] },
    ],
  };

  it("format-only merge without config", () => {
    const r = buildResolver(null);
    expect(r.resolve("mori_president")).toBe("mori-president");
    expect(r.meta("mori-president")).toEqual({ name: "mori-president", kind: "other" });
  });

  it("semantic aliases collapse to canonical + carry name/kind", () => {
    const r = buildResolver(cfg);
    expect(r.resolve("owner")).toBe("okamoto-takaya");
    expect(r.resolve("okamoto_takaya")).toBe("okamoto-takaya");
    expect(r.resolve("okamoto-takaya")).toBe("okamoto-takaya");
    expect(r.resolve("tuzura")).toBe("tsugumi-restaurant");
    expect(r.meta("okamoto-takaya")).toEqual({ name: "岡本隆也", kind: "person" });
    expect(r.meta("tsugumi-restaurant")).toEqual({ name: "鶫", kind: "place" });
  });

  it("passes through unknown slugs unchanged (format-normalized)", () => {
    const r = buildResolver(cfg);
    expect(r.resolve("startup_cto")).toBe("startup-cto");
  });
});
