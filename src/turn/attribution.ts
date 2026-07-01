/**
 * Recall attribution (docs/95 B-1, 96 C-2). `st_recall_log.used_in_reply` was designed to answer
 * "did the surfaced memories actually help?" but was never wired — every row stayed NULL, so there was
 * no signal on recall precision in prod. This is the automatic half: after the reply is generated,
 * decide whether it drew on any recalled claim.
 *
 * Heuristic, and honest about it: character-bigram coverage of a claim by the reply. Bigrams work for
 * space-less Japanese where token overlap doesn't. Noisy by nature (a reply can paraphrase), so it's a
 * *trend* signal — the ground truth is the owner's explicit /good //bad feedback (st_feedback).
 */
function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/**
 * True if the reply echoes any recalled claim's content beyond `coverage` of its bigrams. Skips claims
 * too short to attribute reliably (< 3 bigrams). Empty reply / no hits => false.
 */
export function attributeRecall(reply: string, hits: { claim: string }[], coverage = 0.4): boolean {
  const rb = bigrams(reply);
  if (rb.size === 0) return false;
  for (const h of hits) {
    const cb = bigrams(h.claim);
    if (cb.size < 3) continue; // too short to attribute
    let overlap = 0;
    for (const g of cb) if (rb.has(g)) overlap++;
    if (overlap / cb.size >= coverage) return true;
  }
  return false;
}
