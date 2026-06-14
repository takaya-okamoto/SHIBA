import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAllowlist, InMemoryAllowlist, tryOnboard } from "./allowlist.js";

describe("tryOnboard", () => {
  it("registers on the exact code (trimmed), denies otherwise; fail-closed", async () => {
    const a = new InMemoryAllowlist();
    expect((await tryOnboard(a, "u1", "wrong", "CODE")).status).toBe("denied");
    expect(await a.isAllowed("u1")).toBe(false);
    expect((await tryOnboard(a, "u1", " CODE ", "CODE")).status).toBe("registered");
    expect(await a.isAllowed("u1")).toBe(true);
  });

  it("never registers when the code is empty (owner already registered)", async () => {
    const a = new InMemoryAllowlist();
    expect((await tryOnboard(a, "u", "", "")).status).toBe("denied");
    expect((await tryOnboard(a, "u", "   ", "")).status).toBe("denied");
    expect(await a.isAllowed("u")).toBe(false);
  });
});

describe("FileAllowlist", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "shiba-allow-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists registration across instances (survives a restart)", async () => {
    const path = join(dir, "allowlist.json");
    const a = new FileAllowlist(path);
    expect(await a.hasAny()).toBe(false);
    await a.add("u1");
    expect(await a.isAllowed("u1")).toBe(true);
    // a fresh instance == a process restart; it reads the persisted file
    const restarted = new FileAllowlist(path);
    expect(await restarted.isAllowed("u1")).toBe(true);
    expect(await restarted.hasAny()).toBe(true);
    expect(await restarted.isAllowed("someone-else")).toBe(false);
  });
});
