import type { MemoryItem } from "./types";
import { tokens } from "./util";

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Hybrid retrieval scoped to one owner (Ch17, Ch19).
 * Keyword overlap always runs. Cosine is blended in when both sides have a vector.
 * Items for any other user must be filtered by the caller before they get here;
 * this function also refuses a mismatched owner when `ownerId` is present on the item.
 */
export function retrieve(
  query: string,
  items: (MemoryItem & { userId?: string })[],
  opts: { userId: string; limit?: number; minScore?: number; queryEmbedding?: number[] }
): MemoryItem[] {
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? 0.2;
  const q = tokens(query);
  const qset = new Set(q);
  const ranked = items
    .filter((item) => item.userId === undefined || item.userId === opts.userId)
    .map((item) => {
      const words = tokens(item.text);
      let overlap = 0;
      for (const w of words) if (qset.has(w)) overlap += 1;
      const keyword = words.length === 0 ? 0 : overlap / Math.sqrt(words.length);
      const semantic =
        opts.queryEmbedding && item.embedding ? Math.max(0, cosine(opts.queryEmbedding, item.embedding)) : 0;
      const score = item.embedding && opts.queryEmbedding ? 0.5 * keyword + 0.5 * semantic : keyword;
      return { item, score };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return ranked.slice(0, limit).map((row) => row.item);
}

export function chunkText(text: string, size = 800): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size) chunks.push(clean.slice(i, i + size));
  return chunks;
}
