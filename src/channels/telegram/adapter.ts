import { Bot } from "grammy";
import { config } from "../../config.js";
import type { Notifier } from "../../digest/scheduler.js";
import { redactForLog } from "../../security/redact.js";
import type { SessionManager } from "../../session/manager.js";
import type { TurnLoop } from "../../turn/turn-loop.js";
import { classifyMessage, unsupportedReply } from "./classify.js";
import { createTelegramStream } from "./stream.js";

/** Handle returned by startTelegram: a Notifier for proactive sends + the polling promise. */
export interface TelegramHandle {
  notifier: Notifier;
  /** Resolves when the bot is stopped. */
  started: Promise<void>;
}

/**
 * Telegram via grammy long polling (no public endpoint — docs/91 §1, 98 §1.2). Thin: allowlist +
 * onboarding live in TurnLoop. grammy's sequential polling handles update ordering/dedup. Returns a
 * Notifier so the digest scheduler can push to owners. (Live-untested here; verified on deploy.)
 *
 * Handles all message types (docs/94 A-5): text/caption/location/contact/sticker become turn text;
 * media we can't read yet (image/audio/video) gets a graceful reply. Provenance rides along so
 * forwarded content lands untrusted (docs/98 §3.5).
 */
export function startTelegram(
  token: string,
  turn: TurnLoop,
  sessions?: SessionManager,
  isPaused?: (userId: string) => boolean,
): TelegramHandle {
  const bot = new Bot(token);
  bot.on("message", async (ctx) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : "";
    if (!userId) return;
    const { text, provenance, unsupported } = classifyMessage(ctx.message);
    if (text === null) {
      // Nothing readable yet (image/audio/video/doc without caption) — reply, don't record.
      if (unsupported) await ctx.reply(unsupportedReply(unsupported)).catch(() => {});
      return;
    }
    // Keep the typing indicator alive across the (possibly multi-round, tool-using) reply —
    // Telegram's chat action expires after ~5s, so re-send on an interval until we reply.
    const sendTyping = () => ctx.replyWithChatAction("typing").catch(() => {});
    sendTyping();
    const typing = setInterval(sendTyping, 5000);
    try {
      const history = sessions?.recentHistory(userId) ?? [];
      // Stream the answer by editing one message as it grows (openclaw #7123). Commands / onboarding
      // don't stream (no onDelta fires) — the stream stays empty and we fall back to a plain reply.
      const chatId = ctx.chatId;
      const stream =
        config.streaming.enabled && chatId !== undefined
          ? createTelegramStream(
              {
                send: (t) => ctx.reply(t).then((m) => m.message_id),
                edit: (id, t) => bot.api.editMessageText(chatId, id, t).then(() => {}),
              },
              { throttleMs: config.streaming.throttleMs },
            )
          : undefined;
      const reply = await turn.handleMessage(userId, text, history, (t) => stream?.update(t));
      if (stream) {
        await stream.finalize(reply);
        if (stream.messageId() === undefined && reply) await ctx.reply(reply); // nothing streamed
      } else {
        await ctx.reply(reply);
      }
      // Record the exchange AFTER replying so a boundary flush (extract/commit/reindex) never
      // delays the turn. Skip commands (not memory) and paused users (docs/96 C-2). Non-owners
      // (onboarding) are not recorded into a session/memory.
      const isCommand = text.startsWith("/");
      if (sessions && !isCommand && !isPaused?.(userId) && (await turn.isOwner(userId))) {
        void sessions.record(userId, text, reply, provenance);
      }
    } catch (e) {
      await ctx.reply("いま頭が働きません。あとで試してください。").catch(() => {});
      console.error("turn error:", redactForLog((e as Error).message));
    } finally {
      clearInterval(typing);
    }
  });

  const notifier: Notifier = {
    notify: (userId, text) => bot.api.sendMessage(userId, text).then(() => {}),
  };
  return { notifier, started: bot.start() };
}
