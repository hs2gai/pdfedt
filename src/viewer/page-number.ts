/** Clamps a typed page number to 1..total (full-width digits are accepted). Returns null when it is not a number */
export function parsePageNumber(text: string, total: number): number | null {
  const n = Number.parseInt(text.normalize('NFKC').trim(), 10);
  if (!Number.isFinite(n) || total < 1) return null;
  return Math.min(Math.max(n, 1), total);
}
