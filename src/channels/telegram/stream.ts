/**
 * Telegram "streaming" = send one message, then throttled `editMessageText` as the answer grows
 * (openclaw #7123: "continuously edit the message while respecting rate limits"). Telegram has no
 * token stream, so this is the standard approach. Edits are coalesced (~2/s by default), unchanged
 * text is skipped (Telegram 400s on a no-op edit), and the text is capped to Telegram's 4096 limit.
 * Deliveries are serialized through a promise chain so edits never overlap; on a 429 the stream backs
 * off for retry_after; `finalize()` re-sends the exact final text so the end state is always correct.
 */

export const TELEGRAM_MAX_CHARS = 4096;
const DEFAULT_THROTTLE_MS = 1000;

export interface StreamTransport {
  /** Create the message, return its id (undefined if the send response was lost). */
  send(text: string): Promise<number | undefined>;
  edit(messageId: number, text: string): Promise<void>;
}

export interface TelegramStream {
  /** Set the latest full text; an edit is scheduled (throttled). */
  update(text: string): void;
  /** Flush the exact final text and stop. */
  finalize(text: string): Promise<void>;
  /** The created message id, or undefined if nothing was ever sent (caller can then fall back). */
  messageId(): number | undefined;
}

/** Trim trailing space and cap to Telegram's limit (preview truncates with an ellipsis). */
export function capForTelegram(text: string, max = TELEGRAM_MAX_CHARS): string {
  const t = text.trimEnd();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function createTelegramStream(
  transport: StreamTransport,
  opts: { throttleMs?: number; now?: () => number } = {},
): TelegramStream {
  const throttleMs = Math.max(250, opts.throttleMs ?? DEFAULT_THROTTLE_MS);
  const now = opts.now ?? Date.now;
  let messageId: number | undefined;
  let pending = "";
  let lastSent = "";
  let lastFlushAt = Number.NEGATIVE_INFINITY; // first delivery fires immediately
  let cooldownUntil = 0; // honor Telegram 429 retry_after before the next edit
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  async function deliver(): Promise<void> {
    const text = capForTelegram(pending);
    if (!text || text === lastSent) return;
    lastFlushAt = now();
    try {
      if (messageId === undefined) {
        const id = await transport.send(text);
        if (typeof id === "number") messageId = id;
      } else {
        await transport.edit(messageId, text);
      }
      lastSent = text;
    } catch (e) {
      // On Telegram 429, back off for the server-told retry_after so we don't hammer; other errors
      // are transient preview failures (finalize re-sends the exact text either way).
      const retryAfter = (e as { parameters?: { retry_after?: number } }).parameters?.retry_after;
      if (typeof retryAfter === "number" && retryAfter > 0)
        cooldownUntil = now() + retryAfter * 1000;
    }
  }

  function enqueueDeliver(): Promise<void> {
    queue = queue.then(deliver, deliver); // serialize; never reject the chain
    return queue;
  }

  function schedule(): void {
    if (timer) return;
    const wait = Math.max(0, throttleMs - (now() - lastFlushAt), cooldownUntil - now());
    timer = setTimeout(() => {
      timer = undefined;
      void enqueueDeliver().then(() => {
        if (capForTelegram(pending) !== lastSent) schedule(); // more arrived mid-flush
      });
    }, wait);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    update(text: string): void {
      pending = text;
      schedule();
    },
    async finalize(text: string): Promise<void> {
      pending = text;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await enqueueDeliver();
      // If the final edit was rate-limited, wait out the cooldown once so the exact text still lands.
      const remaining = cooldownUntil - now();
      if (remaining > 0 && capForTelegram(pending) !== lastSent) {
        await new Promise((r) => setTimeout(r, Math.min(5000, remaining)));
        await enqueueDeliver();
      }
    },
    messageId: () => messageId,
  };
}
