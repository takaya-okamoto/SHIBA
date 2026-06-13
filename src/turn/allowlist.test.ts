import { describe, expect, it } from "vitest";
import { InMemoryAllowlist, tryOnboard } from "./allowlist.js";

describe("tryOnboard", () => {
  it("registers on the exact code (trimmed), denies otherwise; fail-closed", async () => {
    const a = new InMemoryAllowlist();
    expect((await tryOnboard(a, "u1", "wrong", "CODE")).status).toBe("denied");
    expect(await a.isAllowed("u1")).toBe(false);
    expect((await tryOnboard(a, "u1", " CODE ", "CODE")).status).toBe("registered");
    expect(await a.isAllowed("u1")).toBe(true);
  });
});
