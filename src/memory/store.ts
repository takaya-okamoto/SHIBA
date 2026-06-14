import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { type FenceFact, serializeFactsBlock } from "./fence.js";
import { safeJoin } from "./paths.js";

const exec = promisify(execFile);

export interface SourceDoc {
  /** path relative to the memory root, e.g. "MEMORY.md" or "memory/2026-06-13.md" */
  relPath: string;
  content: string;
}

/**
 * Source of truth = Markdown + git (docs/91, 94). Reads the memory tree for reindex; commits
 * changes for durability. Writes (appendFact / forget) come with extract in Step 3b.
 */
export class FsGitMemoryStore {
  constructor(private root: string = process.env.MEMORY_DIR ?? "./data/memory") {}

  /** All Markdown docs under the memory root (MEMORY.md, profile.md, memory/*.md). */
  async readAll(): Promise<SourceDoc[]> {
    const rels: string[] = [];
    await this.walk(".", rels);
    const docs: SourceDoc[] = [];
    for (const relPath of rels.filter((p) => p.endsWith(".md")).sort()) {
      docs.push({ relPath, content: await readFile(safeJoin(this.root, relPath), "utf8") });
    }
    return docs;
  }

  private async walk(rel: string, acc: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(safeJoin(this.root, rel), { withFileTypes: true });
    } catch {
      return; // missing memory dir => empty (fresh install)
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel === "." ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) await this.walk(childRel, acc);
      else acc.push(childRel);
    }
  }

  /** Append a new facts fence to today's daily note (creating file/dir if needed). `reindex --all`
   *  rebuilds from all blocks, so append is safe; merging into one fence is a later refinement. */
  async appendFacts(facts: FenceFact[], date: string): Promise<void> {
    if (facts.length === 0) return;
    const abs = safeJoin(this.root, `memory/${date}.md`);
    await mkdir(dirname(abs), { recursive: true });
    await appendFile(abs, `\n\n${serializeFactsBlock(facts)}\n`, "utf8");
  }

  /** Commit all changes (and push if MEMORY_GIT_REMOTE set). No-op if not a git repo / nothing to commit. */
  async commit(message: string): Promise<void> {
    try {
      await exec("git", ["-C", this.root, "add", "-A"]);
      await exec("git", ["-C", this.root, "commit", "-m", message]);
      if (process.env.MEMORY_GIT_REMOTE)
        await exec("git", ["-C", this.root, "push"]).catch(() => {});
    } catch {
      // not a repo / nothing staged — tolerate (skeleton)
    }
  }
}
