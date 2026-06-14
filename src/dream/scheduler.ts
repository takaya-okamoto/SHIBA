import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { localParts, shouldRunDaily } from "../digest/scheduler.js";
import type { LlmClient } from "../llm/client.js";
import { type ReconcileSource, reconcile } from "./reconcile.js";

export interface DreamPolicy {
  enabled: boolean;
  hour: number;
  tzOffsetMin: number;
}

export interface DreamSchedulerDeps {
  source: ReconcileSource;
  llm: LlmClient;
  policy: DreamPolicy;
  statePath?: string;
  now?: () => number;
}

interface DreamState {
  date?: string;
  insights?: string[];
}

/**
 * Nightly memory reconcile (dreaming). Reviews active facts for contradictions/duplicates and stores
 * short "insights" for the next morning's digest. NON-DESTRUCTIVE: never edits facts. Runs once/day.
 */
export class DreamScheduler {
  private now: () => number;
  private statePath: string;
  constructor(private deps: DreamSchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.statePath = deps.statePath ?? `${process.env.STATE_DIR ?? "./data/state"}/dream.json`;
  }

  async tick(): Promise<void> {
    if (!this.deps.policy.enabled) return;
    const nowMs = this.now();
    const { date: lastRun } = await this.loadState();
    const p = this.deps.policy;
    if (!shouldRunDaily(nowMs, lastRun ?? null, p.hour, p.tzOffsetMin)) return;
    const today = localParts(nowMs, p.tzOffsetMin).date;
    const insights = await reconcile(this.deps.source, this.deps.llm);
    await this.saveState({ date: today, insights });
  }

  async insightsFor(date: string): Promise<string[]> {
    const s = await this.loadState();
    return s.date === date ? (s.insights ?? []) : [];
  }

  private async loadState(): Promise<DreamState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as DreamState;
    } catch {
      return {};
    }
  }

  private async saveState(state: DreamState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state), "utf8");
  }
}
