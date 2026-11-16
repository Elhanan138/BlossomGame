/** Normalize text for duplicate detection: case, spaces, punctuation, niqqud. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
