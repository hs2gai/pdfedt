import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';

/**
 * Right-to-left reading order (/ViewerPreferences << /Direction /R2L >>), which Japanese books set for right binding.
 * PDFium's text extraction (FPDFText_LoadPage) takes it as the base direction of bidirectional text, so every line
 * is treated as right-to-left: the neutral brackets at both ends of a vertical column swap places and get mirrored
 * (「テスト」 is read as 「テスト「 with the closing bracket first), and the char order no longer follows the
 * column, which breaks selection, markup and copy.
 * While the document is open the preference is replaced with /L2R; the original is put back around every save.
 */

interface Stash {
  m: WrappedPdfiumModule;
  /** An empty document holding a copy of the original /ViewerPreferences */
  holder: number;
}
const stashes = new Map<string, Stash>();

/** A PDF with nothing but /ViewerPreferences << /Direction /L2R >>, the source to copy the neutral preference from */
export function neutralPreferencesPdf(): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R/ViewerPreferences<</Direction/L2R>>>>',
    '<</Type/Pages/Kids[]/Count 0>>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Whether the document is bound right to left (it is neutralized when registered after opening) */
export const isRightToLeft = (m: WrappedPdfiumModule, docPtr: number) => readDirection(m, docPtr) === 'R2L';

function readDirection(m: WrappedPdfiumModule, docPtr: number): string {
  const u = wasmUtils(m);
  const size = 16;
  const buf = u.malloc(size);
  try {
    const n = m.FPDF_VIEWERREF_GetName(docPtr, 'Direction', buf, size);
    // n includes the trailing NUL; 0 when the key is missing, larger than the buffer for an unexpected long name
    return n > 0 && n <= size ? new TextDecoder().decode(u.readBytes(buf, n - 1)) : '';
  } finally {
    u.free(buf);
  }
}

function copyNeutral(m: WrappedPdfiumModule, docPtr: number) {
  wasmUtils(m).withMemDocument(
    neutralPreferencesPdf(),
    '',
    'FPDF_LoadMemDocument failed (neutral preferences)',
    (source) => m.FPDF_CopyViewerPreferences(docPtr, source),
  );
}

/** Call right after opening (after the incremental baseline is taken, which must see the original catalog) */
export function neutralizeReadingDirection(m: WrappedPdfiumModule, documentId: string, docPtr: number) {
  if (readDirection(m, docPtr) !== 'R2L') return;
  const holder = m.FPDF_CreateNewDocument();
  m.FPDF_CopyViewerPreferences(holder, docPtr);
  stashes.set(documentId, { m, holder });
  copyNeutral(m, docPtr);
}

/** Runs `save` with the original /ViewerPreferences in place, so the saved file keeps its reading order */
export function withOriginalReadingDirection<T>(documentId: string, docPtr: number, save: () => T): T {
  const stash = stashes.get(documentId);
  if (!stash) return save();
  stash.m.FPDF_CopyViewerPreferences(docPtr, stash.holder);
  try {
    return save();
  } finally {
    copyNeutral(stash.m, docPtr);
  }
}

export function forgetReadingDirection(documentId: string) {
  const stash = stashes.get(documentId);
  if (!stash) return;
  stash.m.FPDF_CloseDocument(stash.holder);
  stashes.delete(documentId);
}
