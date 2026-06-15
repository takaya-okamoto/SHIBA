/**
 * Secret / PII scrub (docs/98 §4). Two surfaces:
 *
 *  - `scrubSecrets()` runs on the *memory-storage* path (before extraction/embedding/index) so a raw
 *    secret never lands in memory, embeddings, or the search index (§4.2). Hard secrets (keys / JWT /
 *    PEM / cards via Luhn) are always removed; email + phone (PII, `opts.pii`, default on) too.
 *  - `redactForLog()` runs before any log write (§4.3). The patterns are an import-time snapshot —
 *    there is NO runtime switch to disable it, so config / the LLM can't turn log redaction off.
 */

const REDACTED = "[REDACTED]";

// Hard secrets — always scrubbed, in memory AND logs.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g, // PEM private-key blocks
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style key
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub PAT
  /AKIA[0-9A-Z]{16}/g, // AWS access-key id
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // bearer tokens
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // Telegram bot token
  /\b(?:password|passwd|pwd|token|api[_-]?key|secret|access[_-]?key)\s*[=:]\s*\S+/gi, // key=value
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// JP + international phone shapes, conservative to avoid eating plain numbers / dates.
const PHONE = /(?:\+\d{1,3}[ -]?)?0\d{1,4}[ -]?\d{1,4}[ -]?\d{3,4}\b/g;

function luhnValid(num: string): boolean {
  if (num.length < 13 || num.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Redact 13–19 digit runs (space/dash allowed) that pass Luhn — likely card numbers. */
function scrubCards(text: string): string {
  return text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/[ -]/g, "");
    return luhnValid(digits) ? REDACTED : m;
  });
}

export interface ScrubOptions {
  /** Also scrub PII (email / phone). Default true. Hard secrets are always scrubbed. */
  pii?: boolean;
}

export function scrubSecrets(text: string, opts: ScrubOptions = {}): string {
  const pii = opts.pii ?? true;
  let out = scrubCards(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  if (pii) {
    out = out.replace(EMAIL, REDACTED);
    out = out.replace(PHONE, REDACTED);
  }
  return out;
}

/** Redact hard secrets before logging. No PII (logs must never carry memory content anyway). */
export function redactForLog(text: string): string {
  let out = scrubCards(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
