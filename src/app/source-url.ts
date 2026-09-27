/**
 * Open from a URL (for the Chrome extension).
 * The extension redirects a PDF opened in the browser to index.html#src=<original URL>.
 * It goes in the fragment rather than the query, so ? and & in the original URL can stay as they are.
 */
const PREFIX = '#src=';

export const sourceUrlOf = (hash: string): string | null =>
  hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null;

/** filename from Content-Disposition (RFC 5987 filename* preferred), otherwise the last path segment of the URL. Guarantees a .pdf extension */
export function fileNameFor(url: string, contentDisposition: string | null | undefined): string {
  let name = '';
  const star = contentDisposition?.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  const plain = contentDisposition?.match(/filename\s*=\s*"?([^";]+)"?/);
  if (star) name = safeDecode(star[1].trim());
  else if (plain) name = plain[1].trim();
  if (!name) {
    try {
      name = safeDecode(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    } catch {
      name = '';
    }
  }
  name = name.replace(/[\\/:*?"<>|]/g, '_') || 'document';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Whether the PDF header %PDF- appears within the first 1024 bytes (the spec allows leading junk) */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024 + 5));
  return head.includes('%PDF-');
}
