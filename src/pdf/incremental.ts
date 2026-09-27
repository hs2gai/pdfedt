import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { saveDocument } from './save';
import { parseIncrement, writeSlimIncrement } from './slim-increment';

/**
 * Incremental save per document. Remembers the increment right after opening as the baseline,
 * and at save time drops objects unchanged from it to produce a slim increment.
 * If parsing fails, PDFium's increment is returned as-is (large but correct).
 */
export class IncrementalSaver {
  private baseline: Map<number, Uint8Array> | null = null;

  constructor(
    private readonly m: WrappedPdfiumModule,
    /** Bytes at open time (the original document) */
    readonly original: Uint8Array,
  ) {}

  /** Call right after opening the document (before any change) */
  captureBaseline(docPtr: number) {
    try {
      // PDFium writes "objects loaded into memory" into the increment, so
      // anything touched later by rendering or annotation loading must be loaded first, or it will be missing from the baseline
      // and end up classified as "new" and kept even though it was never changed.
      this.touchAllPages(docPtr);
      const inc = saveDocument(this.m, docPtr, 'incremental');
      if (!this.isAppendedTo(inc)) throw new Error('increment does not start with the original bytes');
      this.baseline = parseIncrement(inc, this.original.length).objects;
    } catch (e) {
      console.warn('incremental baseline unavailable; saves will use the plain increment:', e);
      this.baseline = null;
    }
  }

  save(docPtr: number): Uint8Array {
    const inc = saveDocument(this.m, docPtr, 'incremental');
    if (!this.baseline || !this.isAppendedTo(inc)) return inc;
    try {
      return writeSlimIncrement(this.original, parseIncrement(inc, this.original.length), this.baseline);
    } catch (e) {
      console.warn('slim increment failed; using the plain increment:', e);
      return inc;
    }
  }

  /** Load the content of every page (resources such as fonts and images) and the annotations */
  private touchAllPages(docPtr: number) {
    const m = this.m;
    const n = m.FPDF_GetPageCount(docPtr);
    for (let i = 0; i < n; i++) {
      const page = m.FPDF_LoadPage(docPtr, i);
      if (!page) continue;
      try {
        m.FPDFPage_CountObjects(page); // parse the content stream → load resources
        const count = m.FPDFPage_GetAnnotCount(page);
        for (let j = 0; j < count; j++) {
          const annot = m.FPDFPage_GetAnnot(page, j);
          if (!annot) continue;
          m.FPDFAnnot_GetAP(annot, 0, 0, 0); // load the appearance stream
          m.FPDFPage_CloseAnnot(annot);
        }
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
  }

  private isAppendedTo(inc: Uint8Array): boolean {
    const o = this.original;
    if (inc.length <= o.length) return false;
    // Compare samples from the start, end and middle (comparing the full length is wasteful for large documents)
    for (const i of [0, 1, o.length >> 1, o.length - 2, o.length - 1]) if (inc[i] !== o[i]) return false;
    return true;
  }
}
