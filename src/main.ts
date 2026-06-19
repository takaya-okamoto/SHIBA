import { randomBytes } from "node:crypto";
import "dotenv/config";
import { startTelegram } from "./channels/telegram/adapter.js";
import { config } from "./config.js";
import { TidbDigestSource } from "./digest/digest.js";
import { DigestScheduler } from "./digest/scheduler.js";
import { TidbReconcileSource } from "./dream/reconcile.js";
import { DreamScheduler } from "./dream/scheduler.js";
import { closePool, getPool } from "./index/db.js";
import { checkMeta } from "./index/meta.js";
import { migrate } from "./index/migrate.js";
import { reindex } from "./index/reindex.js";
import { bumpMetric, readMetrics, recordRecall } from "./index/st.js";
import { getLlm } from "./llm/client.js";
import { FsGitMemoryStore } from "./memory/store.js";
import { search } from "./search/index.js";
import { SessionManager } from "./session/manager.js";
import { FsSessionPersistence } from "./session/persistence.js";
import { toLocalDate } from "./session/session.js";
import { FileAllowlist } from "./turn/allowlist.js";
import { type CommandDeps, PauseRegistry, handleCommand } from "./turn/commands.js";
import { TurnLoop } from "./turn/turn-loop.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const DIGEST_TICK_MS = 10 * 60 * 1000;

async function serve(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN required for `serve`");
  // Index identity gate (docs/94 A-3): refuse to start on a schema mismatch; warn on embedding drift.
  await checkMeta(getPool());
  // Allowlist persists under ./data/state (mounted volume), so owner registration survives restarts.
  // Only mint + print a setup code when nobody is registered yet (a fresh install).
  const allowlist = new FileAllowlist();
  let ownerCode = "";
  if (await allowlist.hasAny()) {
    console.log("owner already registered (allowlist persisted in ./data/state).");
  } else {
    ownerCode = randomBytes(4).toString("hex");
    console.log(`owner setup code: ${ownerCode}  (DM this once to the bot to register)`);
  }
  const llm = getLlm();
  const store = new FsGitMemoryStore();
  const pause = new PauseRegistry();
  const commandDeps: CommandDeps = {
    search: (q) => search(q),
    store,
    reindex: () => reindex({}),
    pause,
    scrubPii: config.security.scrubPii,
    metrics: async () => {
      try {
        const m = await readMetrics(getPool(), toLocalDate(Date.now()));
        return m ? `・今日: ${m.turns}ターン / 想起 ${m.recalls}件` : "";
      } catch {
        return "";
      }
    },
  };
  const turn = new TurnLoop({
    llm,
    search: (q) => search(q),
    allowlist,
    store,
    reindex: () => reindex({}),
    ownerCode,
    onRecall: (q, ids) => {
      // fire-and-forget; never delay a turn. One recall ≈ one normal turn, so bump both counters.
      const pool = getPool();
      const day = toLocalDate(Date.now());
      void recordRecall(pool, q, ids).catch(() => {});
      void bumpMetric(pool, day, "recalls").catch(() => {});
      void bumpMetric(pool, day, "turns").catch(() => {});
    },
    commands: (userId, text) => handleCommand(userId, text, commandDeps),
  });

  // Step 3c: track sessions and flush them (extract -> remember) at the boundary. The periodic
  // sweep closes sessions that simply went quiet; a final flush runs on shutdown. Sessions are
  // persisted (docs/94 A-1) and recovered here so a restart never drops unflushed conversation.
  const sessions = new SessionManager(turn, undefined, undefined, new FsSessionPersistence());
  await sessions.recover();
  const sweep = setInterval(() => {
    sessions.sweep().catch((e) => console.error("session sweep:", (e as Error).message));
  }, SWEEP_INTERVAL_MS);
  sweep.unref();
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      console.log(`${sig}: flushing ${sessions.openCount} open session(s) ...`);
      sessions.flushAll().finally(() => process.exit(0));
    });
  }

  const { notifier, started } = startTelegram(token, turn, sessions, (u) => pause.isPaused(u));

  // Nightly dreaming: reconcile facts -> insights for the next morning's digest (non-destructive).
  const dream = new DreamScheduler({
    source: new TidbReconcileSource(),
    llm,
    policy: config.dream,
  });
  if (config.dream.enabled) {
    const dreamTimer = setInterval(() => {
      dream.tick().catch((e) => console.error("dream tick:", (e as Error).message));
    }, DIGEST_TICK_MS);
    dreamTimer.unref();
  }

  // Morning digest: today's + overdue commitments, plus last night's dream insights (silence
  // principle; once/day, outside quiet hours). State in ./data/state.
  if (config.digest.enabled) {
    const digest = new DigestScheduler({
      source: new TidbDigestSource(),
      notifier,
      recipients: () => allowlist.list(),
      policy: config.digest,
      insights: (today) => dream.insightsFor(today),
    });
    const digestTimer = setInterval(() => {
      digest.tick().catch((e) => console.error("digest tick:", (e as Error).message));
    }, DIGEST_TICK_MS);
    digestTimer.unref();
  }

  console.log("starting Telegram long polling ...");
  await started; // resolves when the bot is stopped
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "migrate":
      await migrate();
      break;
    case "reindex":
      await reindex({ all: rest.includes("--all") });
      break;
    case "search": {
      const q = rest.join(" ").trim();
      if (!q) throw new Error('usage: pnpm search "<query>"');
      const hits = await search(q);
      if (hits.length === 0) console.log("(no results)");
      for (const h of hits) {
        const tag = h.sourceTrust === "untrusted" ? " [untrusted]" : "";
        console.log(`${h.score.toFixed(4)}  ${h.routes.join("+")}${tag}  ${h.claim}`);
      }
      break;
    }
    case "eval": {
      // Offline search-regression harness (docs/95 B-1). No DB needed; exits non-zero on failure.
      const { runAllFixtures, formatReport } = await import("./eval/runner.js");
      const results = await runAllFixtures();
      console.log(formatReport(results));
      if (results.some((r) => !r.passed)) process.exitCode = 1;
      break;
    }
    case "serve":
      await serve(); // runs until killed; don't close the pool
      return;
    default:
      console.log('commands: serve | migrate | reindex [--all] | search "<query>" | eval');
  }
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
