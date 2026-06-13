import { randomBytes } from "node:crypto";
import "dotenv/config";
import { startTelegram } from "./channels/telegram/adapter.js";
import { closePool } from "./index/db.js";
import { migrate } from "./index/migrate.js";
import { reindex } from "./index/reindex.js";
import { getLlm } from "./llm/client.js";
import { FsGitMemoryStore } from "./memory/store.js";
import { search } from "./search/index.js";
import { InMemoryAllowlist } from "./turn/allowlist.js";
import { TurnLoop } from "./turn/turn-loop.js";

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
  console.log("starting Telegram long polling ...");
  // NOTE: session-close flush (turn.closeSession) is not yet scheduled — needs a session store +
  // idle sweep (Step 3c). handleMessage (recall + respond) works now.
  await startTelegram(token, turn); // resolves when the bot is stopped
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
