export interface Chunk {
  heading: string | null;
  content: string;
}

const MAX_CHARS = 500;

/**
 * CJK-aware chunker (docs/90 §2): section by heading, paragraph by blank line, split long
 * paragraphs on sentence enders (。！？!?). Fenced blocks (```facts and other code) are dropped —
 * facts are indexed structurally (fence.ts), not as prose chunks.
 */
export function chunkMarkdown(md: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (!text) return;
    for (const piece of splitLong(text)) chunks.push({ heading, content: piece });
  };

  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1]!.trim();
      continue;
    }
    if (t === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  let cur = "";
  for (const sentence of text.split(/(?<=[。！？!?])/)) {
    if (cur.length + sentence.length > MAX_CHARS && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
