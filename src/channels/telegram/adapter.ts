import { Bot } from "grammy";
import type { SessionManager } from "../../session/manager.js";
import type { TurnLoop } from "../../turn/turn-loop.js";

/**
 * Telegram via grammy long polling (no public endpoint — docs/91 §1, 98 §1.2). Thin: allowlist +
 * onboarding live in TurnLoop. grammy's sequential polling handles update ordering/dedup.
 * (Live-untested here; verified on deploy with a real bot token.)
 */
export function startTelegram(
  token: string,
  turn: TurnLoop,
  sessions?: SessionManager,
): Promise<void> {
  const bot = new Bot(token);
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : "";
    if (!userId) return;
    await ctx.replyWithChatAction("typing").catch(() => {});
    try {
      const reply = await turn.handleMessage(userId, ctx.message.text);
      await ctx.reply(reply);
      // Record the owner's message AFTER replying so a boundary flush (extract/commit/reindex)
      // never delays the user's turn. Non-owners (onboarding) are not recorded into memory.
      if (sessions && (await turn.isOwner(userId))) {
        void sessions.record(userId, ctx.message.text);
      }
    } catch (e) {
      await ctx.reply("いま頭が働きません。あとで試してください。").catch(() => {});
      console.error("turn error:", (e as Error).message);
    }
  });
  return bot.start();
}
