import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';
import { saveDocument } from './save';

/** fpdf_flatten.h */
const FLAT_PRINT = 1;

/**
 * Builds a PDF with annotations burned into the content (for submission).
 * The working document is untouched; the full-save bytes are opened as a separate document and processed.
 * `password` is the open password of an encrypted document (the full save keeps its encryption).
 */
export function flattenCopy(m: WrappedPdfiumModule, docPtr: number, password = ''): Uint8Array {
  const u = wasmUtils(m);
  const source = saveDocument(m, docPtr, 'full');
  return u.withMemDocument(source, password, 'FPDF_LoadMemDocument failed', (tmp) => {
    const n = m.FPDF_GetPageCount(tmp);
    for (let i = 0; i < n; i++) {
      const page = m.FPDF_LoadPage(tmp, i);
      try {
        // FLATTEN_FAIL=0 / FLATTEN_SUCCESS=1 / FLATTEN_NOTHINGTODO=2
        if (m.FPDFPage_Flatten(page, FLAT_PRINT) === 0) throw new Error(`FPDFPage_Flatten failed on page ${i + 1}`);
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
    return saveDocument(m, tmp, 'full');
  });
}
