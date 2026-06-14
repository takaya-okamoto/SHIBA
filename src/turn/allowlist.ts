import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Access boundary (docs/98 §1.1, 92 §2-1): only registered owner ids may touch memory. */
export interface AllowlistStore {
  isAllowed(userId: string): Promise<boolean>;
  add(userId: string): Promise<void>;
  /** Has anyone registered yet? Used to decide whether to print a fresh owner setup code. */
  hasAny(): Promise<boolean>;
  /** All registered owner ids (e.g. recipients for the morning digest). */
  list(): Promise<string[]>;
}

/** In-memory allowlist (tests / ephemeral). Not persisted — use FileAllowlist in production. */
export class InMemoryAllowlist implements AllowlistStore {
  private ids = new Set<string>();
  async isAllowed(id: string): Promise<boolean> {
    return this.ids.has(id);
  }
  async add(id: string): Promise<void> {
    this.ids.add(id);
  }
  async hasAny(): Promise<boolean> {
    return this.ids.size > 0;
  }
  async list(): Promise<string[]> {
    return [...this.ids];
  }
}

/**
 * File-backed allowlist persisted under the mounted data volume (./data/state/allowlist.json), so
 * owner registration survives restarts/redeploys. Loaded lazily; each add() rewrites the JSON array.
 */
export class FileAllowlist implements AllowlistStore {
  private ids: Set<string> | null = null;
  constructor(private path = `${process.env.STATE_DIR ?? "./data/state"}/allowlist.json`) {}

  private async load(): Promise<Set<string>> {
    if (this.ids) return this.ids;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      this.ids = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      this.ids = new Set(); // missing/corrupt => empty (fresh install)
    }
    return this.ids;
  }

  async isAllowed(id: string): Promise<boolean> {
    return (await this.load()).has(id);
  }

  async add(id: string): Promise<void> {
    const ids = await this.load();
    ids.add(id);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify([...ids]), "utf8");
  }

  async hasAny(): Promise<boolean> {
    return (await this.load()).size > 0;
  }

  async list(): Promise<string[]> {
    return [...(await this.load())];
  }
}

export interface OnboardResult {
  status: "registered" | "denied";
  reply: string;
}

/**
 * One-time-code owner onboarding (docs/96 C-4): until someone sends the exact setup code, the bot
 * responds minimally and registers no one (fail-closed; not "first to message wins"). An empty code
 * (owner already registered) never matches, so onboarding is effectively closed.
 */
export async function tryOnboard(
  store: AllowlistStore,
  userId: string,
  text: string,
  code: string,
): Promise<OnboardResult> {
  if (code && text.trim() === code) {
    await store.add(userId);
    return { status: "registered", reply: "登録しました。これから会話を覚えます。" };
  }
  return { status: "denied", reply: "セットアップコードを送ってください。" };
}
