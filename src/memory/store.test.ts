import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsGitMemoryStore } from "./store.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shiba-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FsGitMemoryStore.readFacts / supersede", () => {
  it("reads facts tagged with their source file", async () => {
    await writeFile(
      join(root, "MEMORY.md"),
      "```facts v1\n- [preference] コーヒーはブラック @owner\n```\n",
      "utf8",
    );
    const store = new FsGitMemoryStore(root);
    const facts = await store.readFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]?.relPath).toBe("MEMORY.md");
    expect(facts[0]?.claim).toBe("コーヒーはブラック");
  });

  it("strikes the matching active fact line through (soft-delete, 98 §5.2)", async () => {
    const md =
      "```facts v1\n- [preference] コーヒーはブラック @owner\n- [fact] 猫を飼っている @owner\n```\n";
    await writeFile(join(root, "MEMORY.md"), md, "utf8");
    const store = new FsGitMemoryStore(root);
    const n = await store.supersede([{ relPath: "MEMORY.md", claim: "コーヒーはブラック" }]);
    expect(n).toBe(1);
    const after = await readFile(join(root, "MEMORY.md"), "utf8");
    expect(after).toContain("~~[preference] コーヒーはブラック~~");
    expect(after).toContain("- [fact] 猫を飼っている @owner"); // untouched
    // re-derivable: parsing the struck line yields a superseded fact
    const facts = await store.readFacts();
    expect(facts.find((f) => f.claim === "コーヒーはブラック")?.state).toBe("superseded");
  });

  it("is a no-op when the claim does not match", async () => {
    await writeFile(join(root, "MEMORY.md"), "```facts v1\n- [fact] X @owner\n```\n", "utf8");
    const store = new FsGitMemoryStore(root);
    expect(await store.supersede([{ relPath: "MEMORY.md", claim: "Y" }])).toBe(0);
  });
});
