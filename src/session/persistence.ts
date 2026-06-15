/**
 * Session persistence (docs/94 A-1, 90 §3-④): a live session lives in a Map, so a restart would drop
 * any conversation not yet flushed to memory. We persist each open session's owner inputs to disk and
 * recover them on startup, so the next sweep still extracts → remembers them. (v1 keeps it simple:
 * whole-file JSON per user rather than per-turn JSONL — sessions are small, <50 turns.)
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Provenance } from "../extract/extract.js";
import type { SessionState } from "./session.js";

export interface PersistedSession {
  userId: string;
  state: SessionState;
  inputs: { text: string; provenance: Provenance }[];
}

export interface SessionPersistence {
  save(userId: string, data: PersistedSession): Promise<void>;
  remove(userId: string): Promise<void>;
  loadAll(): Promise<Map<string, PersistedSession>>;
}

/** Slug a userId into a safe filename (Telegram ids are numeric, but be defensive). */
function fileFor(userId: string): string {
  return `${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

export class FsSessionPersistence implements SessionPersistence {
  constructor(private dir: string = process.env.SESSION_DIR ?? "./data/state/sessions") {}

  async save(userId: string, data: PersistedSession): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, fileFor(userId)), JSON.stringify(data), "utf8");
  }

  async remove(userId: string): Promise<void> {
    await rm(join(this.dir, fileFor(userId)), { force: true });
  }

  async loadAll(): Promise<Map<string, PersistedSession>> {
    const out = new Map<string, PersistedSession>();
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return out; // no state dir yet
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await readFile(join(this.dir, name), "utf8")) as PersistedSession;
        if (data?.userId && data.state && Array.isArray(data.inputs)) out.set(data.userId, data);
      } catch {
        // corrupt file — skip (don't crash startup over one bad session)
      }
    }
    return out;
  }
}
