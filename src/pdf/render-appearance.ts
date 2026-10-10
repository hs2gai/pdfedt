import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';
import type { Appearance } from './appearance';

/** fpdfview.h */
const FPDFBitmap_BGRA = 4;

/**
 * Renders an appearance PDF (1 page) to a bitmap (for stamp previews).
 * Drawn by the same PDFium as the viewer, so it looks identical to the stamped result.
 */
export function renderAppearance(m: WrappedPdfiumModule, appearance: Appearance, scale: number): ImageData {
  const u = wasmUtils(m);
  const w = Math.max(1, Math.round(appearance.width * scale));
  const h = Math.max(1, Math.round(appearance.height * scale));
  return u.withMemDocument(appearance.pdf, '', 'FPDF_LoadMemDocument failed', (doc) => {
    const page = m.FPDF_LoadPage(doc, 0);
    if (!page) throw new Error('FPDF_LoadPage failed');
    const bmp = m.FPDFBitmap_CreateEx(w, h, FPDFBitmap_BGRA, 0, 0);
    try {
      m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0x00000000);
      m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0);
      const buf = m.FPDFBitmap_GetBuffer(bmp);
      const bgra = m.pdfium.HEAPU8.subarray(buf, buf + w * h * 4);
      const out = new ImageData(w, h);
      for (let i = 0; i < bgra.length; i += 4) {
        out.data[i] = bgra[i + 2];
        out.data[i + 1] = bgra[i + 1];
        out.data[i + 2] = bgra[i];
        out.data[i + 3] = bgra[i + 3];
      }
      return out;
    } finally {
      m.FPDFBitmap_Destroy(bmp);
      m.FPDF_ClosePage(page);
    }
  });
}
