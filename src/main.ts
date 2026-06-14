import { randomBytes } from "node:crypto";
import "dotenv/config";
import { startTelegram } from "./channels/telegram/adapter.js";
import { closePool } from "./index/db.js";
import { migrate } from "./index/migrate.js";
import { reindex } from "./index/reindex.js";
import { getLlm } from "./llm/client.js";
import { FsGitMemoryStore } from "./memory/store.js";
import { search } from "./search/index.js";
import { SessionManager } from "./session/manager.js";
import { InMemoryAllowlist } from "./turn/allowlist.js";
import { TurnLoop } from "./turn/turn-loop.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function serve(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN required for `serve`");
  const ownerCode = randomBytes(4).toString("hex");
  console.log(`owner setup code: ${ownerCode}  (DM this once to the bot to register)`);
  const turn = new TurnLoop({
    llm: getLlm(),
    search: (q) => search(q),
    allowlist: new InMemoryAllowlist(), // TODO: TiDB st_allowlist (persist across restarts)
    store: new FsGitMemoryStore(),
    reindex: () => reindex({}),
    ownerCode,
  });

  // Step 3c: track sessions and flush them (extract -> remember) at the boundary. The periodic
  // sweep closes sessions that simply went quiet; a final flush runs on shutdown.
  const sessions = new SessionManager(turn);
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

  console.log("starting Telegram long polling ...");
  await startTelegram(token, turn, sessions); // resolves when the bot is stopped
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
    case "serve":
      await serve(); // runs until killed; don't close the pool
      return;
    default:
      console.log('commands: serve | migrate | reindex [--all] | search "<query>"');
  }
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
