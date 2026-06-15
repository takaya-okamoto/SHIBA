/**
 * Telegram "streaming" = send one message, then throttled `editMessageText` as the answer grows
 * (openclaw #7123: "continuously edit the message while respecting rate limits"). Telegram has no
 * token stream, so this is the standard approach. Edits are coalesced (≈1/s), unchanged text is
 * skipped (Telegram 400s on a no-op edit), and the text is capped to Telegram's 4096-char limit.
 * Deliveries are serialized through a promise chain so edits never overlap; preview errors (rate
 * limits etc.) are swallowed — `finalize()` re-sends the exact final text so the end state is correct.
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
    } catch {
      // best-effort preview; rate-limit / edit errors are ignored (finalize re-sends the final text)
    }
  }

  function enqueueDeliver(): Promise<void> {
    queue = queue.then(deliver, deliver); // serialize; never reject the chain
    return queue;
  }

  function schedule(): void {
    if (timer) return;
    const wait = Math.max(0, throttleMs - (now() - lastFlushAt));
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
    },
    messageId: () => messageId,
  };
}
