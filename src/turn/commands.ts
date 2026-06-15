/**
 * Owner command system (docs/96 C-2). `/`-prefixed messages are commands, not memory — they're routed
 * here (before the normal turn) and never recorded into a session. The parser is pure; the router
 * takes injected collaborators so it's unit-testable without Telegram or a DB.
 */
import type { SearchHit } from "../types.js";
import { buildRememberFact, matchForget, targetsOf } from "./memory-tools.js";
import type { MemoryWriter } from "./turn-loop.js";

export interface ParsedCommand {
  cmd: string;
  arg: string;
}

/** Parse `/cmd[@bot] [args]`. Returns null for ordinary (non-command) text. */
export function parseCommand(text: string): ParsedCommand | null {
  const m = text.trim().match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { cmd: (m[1] ?? "").toLowerCase(), arg: (m[2] ?? "").trim() };
}

export const HELP_TEXT = `🐕 使えるコマンド
/help — このヘルプ
/search <ことば> — 記憶を検索
/remember <こと> — いま覚える
/forget <ことば> — その記憶を取り消す(あとで復元可)
/status — 記憶の状態を見る
/pause — 自動で覚えるのを止める
/resume — 自動で覚えるのを再開
/digest — きょうのダイジェストを今すぐ`;

/** In-memory pause registry (auto-capture off per user, docs/96 C-2). v1: not persisted across restarts. */
export class PauseRegistry {
  private paused = new Set<string>();
  isPaused(userId: string): boolean {
    return this.paused.has(userId);
  }
  set(userId: string, paused: boolean): void {
    if (paused) this.paused.add(userId);
    else this.paused.delete(userId);
  }
}

export interface CommandDeps {
  search: (q: string) => Promise<SearchHit[]>;
  store: MemoryWriter;
  reindex: () => Promise<void>;
  pause: PauseRegistry;
  scrubPii: boolean;
  /** Optional: produce today's digest text on demand (/digest). */
  digest?: (userId: string) => Promise<string>;
  /** Optional: extra status line (e.g. today's metrics from st_metrics). */
  metrics?: () => Promise<string>;
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "(該当する記憶なし)";
  return hits
    .map((h) => `・${h.sourceTrust === "untrusted" ? "[untrusted] " : ""}${h.claim}`)
    .join("\n");
}

/**
 * Route a command. Returns the reply text, or null if `text` isn't a command (caller proceeds with a
 * normal turn). Owner-gating is the caller's job (commands run only for the allowlisted owner).
 */
export async function handleCommand(
  userId: string,
  text: string,
  deps: CommandDeps,
): Promise<string | null> {
  const parsed = parseCommand(text);
  if (!parsed) return null;
  const { cmd, arg } = parsed;

  switch (cmd) {
    case "help":
      return HELP_TEXT;

    case "search":
      if (!arg) return "使い方: /search <検索したいことば>";
      return formatHits(await deps.search(arg));

    case "remember": {
      if (!arg) return "使い方: /remember <覚えたいこと>";
      const fact = buildRememberFact({ claim: arg }, deps.scrubPii);
      if (!fact) return "覚える内容が空だよ。";
      await deps.store.appendFacts([fact], todayLocal());
      await deps.store.commit("remember (command)");
      await deps.reindex();
      return `覚えたよ:「${fact.claim}」`;
    }

    case "forget": {
      if (!arg) return "使い方: /forget <取り消したいことば>";
      const hits = matchForget(await deps.store.readFacts(), arg);
      if (hits.length === 0) return "その記憶は見つからなかったよ。";
      await deps.store.supersede(targetsOf(hits));
      await deps.store.commit("forget (command)");
      await deps.reindex();
      return `取り消したよ: ${hits.map((f) => `「${f.claim}」`).join("、")}`;
    }

    case "pause":
      deps.pause.set(userId, true);
      return "自動で覚えるのを止めたよ。/resume で再開できる。";

    case "resume":
      deps.pause.set(userId, false);
      return "また自動で覚えるね。";

    case "status": {
      const facts = await deps.store.readFacts();
      const active = facts.filter((f) => f.state === "active");
      const untrusted = active.filter((f) => f.sourceTrust === "untrusted").length;
      const lines = [
        "🐕 SHIBA の状態",
        `・記憶: 有効 ${active.length}件(untrusted ${untrusted}件)`,
        `・自動記憶: ${deps.pause.isPaused(userId) ? "停止中(/resume で再開)" : "オン"}`,
      ];
      if (deps.metrics) lines.push(await deps.metrics());
      return lines.join("\n");
    }

    case "digest":
      return deps.digest
        ? await deps.digest(userId)
        : "オンデマンドのダイジェストはまだ準備中。朝の自動ダイジェストで届くよ。";

    case "correct":
      return "「/forget <消したい内容>」で取り消してから、正しいことを教えてね。";

    default:
      return "知らないコマンドだよ。/help を見てね。";
  }
}

/** Local YYYY-MM-DD (the daily-note a command write lands in). */
function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
