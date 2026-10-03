import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';
import { t } from '../i18n';

/**
 * Page structure operations (delete, reorder, rotate, import another PDF). Uses raw PDFium directly.
 * The caller then builds full-save bytes and reopens the document (matching each of EmbedPDF's
 * page list / annotation / thumbnail states individually is fragile).
 */

export function deletePage(m: WrappedPdfiumModule, docPtr: number, index: number): void {
  m.FPDFPage_Delete(docPtr, index);
}

/**
 * Rotates a page by quarter turns (1 = 90° clockwise, -1 = counterclockwise) by rewriting its /Rotate.
 * Annotations keep their page coordinates and turn with the page
 */
export function rotatePage(m: WrappedPdfiumModule, docPtr: number, index: number, quarterTurns: number): void {
  const page = m.FPDF_LoadPage(docPtr, index);
  if (!page) throw new Error(t('pages.rotateFailed'));
  try {
    m.FPDFPage_SetRotation(page, (((m.FPDFPage_GetRotation(page) + quarterTurns) % 4) + 4) % 4);
  } finally {
    m.FPDF_ClosePage(page);
  }
}

/**
 * Moves page `from` to "before page `to`" in the current order (to = page count means the end).
 * FPDF_MovePages' dest is the position in the order "without the moved page", so subtract 1 when moving backwards.
 */
export function movePage(m: WrappedPdfiumModule, docPtr: number, from: number, to: number): void {
  const dest = to > from ? to - 1 : to;
  if (dest === from) return;
  const u = wasmUtils(m);
  const p = u.malloc(4);
  try {
    m.pdfium.setValue(p, from, 'i32');
    if (!m.FPDF_MovePages(docPtr, p, 1, dest)) throw new Error(t('pages.moveFailed'));
  } finally {
    u.free(p);
  }
}

/**
 * Imports every page of another PDF at insertIndex. Returns the number of imported pages.
 * throws for PDFs that cannot be opened (e.g. password protected)
 */
export function importPdf(m: WrappedPdfiumModule, docPtr: number, bytes: Uint8Array, insertIndex: number): number {
  const u = wasmUtils(m);
  return u.withBytes(bytes, (ptr, len) => {
    const src = m.FPDF_LoadMemDocument(ptr, len, '');
    if (!src) throw new Error(t('pages.importOpenFailed'));
    try {
      const count = m.FPDF_GetPageCount(src);
      const indices = u.malloc(count * 4);
      try {
        for (let i = 0; i < count; i++) m.pdfium.setValue(indices + i * 4, i, 'i32');
        if (!m.FPDF_ImportPagesByIndex(docPtr, src, indices, count, insertIndex)) {
          throw new Error(t('pages.importFailed'));
        }
      } finally {
        u.free(indices);
      }
      return count;
    } finally {
      m.FPDF_CloseDocument(src);
    }
  });
}
