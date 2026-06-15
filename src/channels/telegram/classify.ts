/**
 * Classify an incoming Telegram message into turn text + provenance (docs/94 A-5, 98 §3.5).
 *
 * v1 reads what needs no external API: plain text, captions, location/venue, contact, sticker. Image
 * OCR (vision) and voice STT need a live API + an SSRF-guarded fetch (docs/98 §7) and are deferred —
 * those arrive as `unsupported` so the adapter can reply gracefully. Pure + structurally typed so it
 * unit-tests without grammy. A forwarded message is other-people's text → `forwarded` (untrusted).
 */
import type { Provenance } from "../../extract/extract.js";

export interface TgMessage {
  text?: string;
  caption?: string;
  forward_origin?: unknown;
  forward_date?: number;
  forward_from?: unknown;
  location?: { latitude: number; longitude: number };
  venue?: { title?: string; address?: string };
  contact?: { first_name?: string; last_name?: string; phone_number?: string };
  sticker?: { emoji?: string };
  photo?: unknown;
  voice?: unknown;
  audio?: unknown;
  video?: unknown;
  video_note?: unknown;
  document?: { file_name?: string };
}

export type UnsupportedMedia = "image" | "audio" | "video" | "document";

export interface ClassifiedMessage {
  /** Text to feed the turn loop, or null when there's nothing readable yet. */
  text: string | null;
  provenance: Provenance;
  /** A media type we can't read yet (caller replies gracefully). */
  unsupported?: UnsupportedMedia;
}

export function provenanceOfMessage(msg: TgMessage): Provenance {
  return msg.forward_origin || msg.forward_date || msg.forward_from ? "forwarded" : "owner-typed";
}

export function classifyMessage(msg: TgMessage): ClassifiedMessage {
  const provenance = provenanceOfMessage(msg);
  const at = (text: string | null, unsupported?: UnsupportedMedia): ClassifiedMessage => ({
    text,
    provenance,
    unsupported,
  });

  if (msg.text) return at(msg.text);
  if (msg.location) {
    return at(`現在地を共有: 緯度 ${msg.location.latitude}, 経度 ${msg.location.longitude}`);
  }
  if (msg.venue) {
    return at(`場所を共有: ${[msg.venue.title, msg.venue.address].filter(Boolean).join(" / ")}`);
  }
  if (msg.contact) {
    const name = [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(" ");
    return at(`連絡先を共有: ${[name, msg.contact.phone_number].filter(Boolean).join(" ")}`.trim());
  }
  if (msg.sticker?.emoji) return at(`(スタンプ ${msg.sticker.emoji})`);
  // media with a caption: the typed caption is the readable part; the media itself isn't read yet
  if (msg.caption) return at(msg.caption);
  if (msg.photo) return at(null, "image");
  if (msg.voice || msg.audio || msg.video_note) return at(null, "audio");
  if (msg.video) return at(null, "video");
  if (msg.document) return at(null, "document");
  return at(null);
}

/** Friendly reply for a media type SHIBA can't read yet (keeps the bot honest, not silent). */
export function unsupportedReply(kind: UnsupportedMedia): string {
  switch (kind) {
    case "image":
      return "ごめん、まだ画像は読めないんだ🐕 大事なことなら文字でも教えてくれる?";
    case "audio":
      return "ごめん、まだ音声は聞き取れないんだ。文字にしてくれたら覚えるよ。";
    case "video":
      return "ごめん、まだ動画は見られないんだ。要点を文字で教えてくれる?";
    case "document":
      return "ごめん、まだファイルの中身は読めないんだ。大事な点を文字で教えて。";
  }
}
