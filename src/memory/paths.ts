import { isAbsolute, normalize, resolve, sep } from "node:path";

const SLUG_RE = /^[a-z0-9_-]+$/;

/** Entity / source slugs must be ^[a-z0-9_-]+$ (docs/98 §6). */
export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

/**
 * Resolve a relative path inside the memory root, rejecting traversal / absolute / home / null byte
 * (docs/98 §6, letta-style). Returns an absolute path guaranteed to be within `root`.
 */
export function safeJoin(root: string, rel: string): string {
  if (rel.includes("\0")) throw new Error("null byte in path");
  if (isAbsolute(rel) || rel.startsWith("~")) throw new Error(`absolute/home path rejected: ${rel}`);
  const rootAbs = resolve(root);
  const resolved = resolve(rootAbs, normalize(rel));
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes memory root: ${rel}`);
  }
  return resolved;
}
