import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsSessionPersistence, type PersistedSession } from "./persistence.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shiba-sess-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample = (userId: string): PersistedSession => ({
  userId,
  state: { startedAt: 1000, lastMessageAt: 2000, turnCount: 2 },
  inputs: [
    { text: "好きな色は青", provenance: "owner-typed" },
    { text: "転送だよ", provenance: "forwarded" },
  ],
});

describe("FsSessionPersistence", () => {
  it("saves and reloads sessions keyed by userId", async () => {
    const p = new FsSessionPersistence(dir);
    await p.save("123", sample("123"));
    await p.save("456", sample("456"));
    const all = await p.loadAll();
    expect([...all.keys()].sort()).toEqual(["123", "456"]);
    expect(all.get("123")?.inputs[1]?.provenance).toBe("forwarded");
  });

  it("removes a flushed session's file", async () => {
    const p = new FsSessionPersistence(dir);
    await p.save("123", sample("123"));
    await p.remove("123");
    expect((await p.loadAll()).size).toBe(0);
  });

  it("returns empty when the dir does not exist yet", async () => {
    const p = new FsSessionPersistence(join(dir, "missing"));
    expect((await p.loadAll()).size).toBe(0);
  });
});
