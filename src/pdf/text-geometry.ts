import type { PdfDocumentObject, PdfPageGeometry, PdfPageObject, PdfRun } from '@embedpdf/models';
import { PdfTaskHelper, type PdfTask } from '@embedpdf/models';
import type { PdfEngine } from '@embedpdf/engines/pdfium';
import type { PdfRuntime } from './engine';
import { wasmUtils } from './wasm-utils';
import { withTextPage } from './raw';

/**
 * Correction of character rectangles (the basis of selection, highlight, underline and strikeout).
 * EmbedPDF uses FPDFText_GetLooseCharBox, which goes wrong in two ways:
 * - Too tall: the box is built from the font-wide FontBBox, so Latin text set in a CJK font
 *   (e.g. "Linux" in Harano Aji) gets a 29pt box for 10pt characters, overlapping the neighboring line.
 * - Too short: the height is the raw Tf size and ignores the text matrix scale, so PDFs that set
 *   "1 Tf" and put the real size in Tm (Word + Acrobat PDFMaker: "/C2_0 1 Tf 12 0 0 12 x y Tm")
 *   get 1pt boxes for 12pt characters, and a highlight shrinks to a thin line.
 * Such boxes are replaced with a 1 em box based on the baseline, using the effective font size
 * (Tf size × vertical scale of the character matrix).
 */

/** Boxes taller than this (relative to the effective font size) are treated as abnormal. Normal Japanese boxes are 0.9–1.1× */
const TALL_RATIO = 1.6;
/** Boxes shorter than this (relative to the effective font size) are treated as abnormal */
const SHORT_RATIO = 0.5;
/** Replacement box: 0.88 em above and 0.12 em below the baseline (typical ascent / descent of Japanese fonts) */
const ASCENT = 0.88;

export function installTextGeometryFix(runtime: PdfRuntime): void {
  const engine = runtime.engine as PdfEngine<Blob>;
  const original = engine.getPageGeometry.bind(engine);
  engine.getPageGeometry = (doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageGeometry> => {
    const task = PdfTaskHelper.create<PdfPageGeometry>();
    original(doc, page).wait(
      (geo) => task.resolve(fixGlyphBoxes(runtime, doc, page, geo)),
      (e) => task.fail(e),
    );
    return task;
  };
}

function fixGlyphBoxes(runtime: PdfRuntime, doc: PdfDocumentObject, page: PdfPageObject, geo: PdfPageGeometry): PdfPageGeometry {
  // Cheap pre-filter without PDFium calls: too tall for the Tf size, or smaller than the glyph's own tight box
  // (a loose box never is, unless the text matrix scale was ignored)
  const suspicious = geo.runs.filter((run) => {
    const fs = run.fontSize ?? 0;
    return fs > 0 && run.glyphs.some((g) => g.height > fs * TALL_RATIO || (g.tightHeight ?? 0) > g.height + 1);
  });
  if (suspicious.length === 0) return geo;

  const m = runtime.pdfium;
  const u = wasmUtils(m);
  withTextPage(runtime.native, doc.id, page.index, (pagePtr, textPagePtr) => {
    const xPtr = u.malloc(8);
    const yPtr = u.malloc(8);
    const dxPtr = u.malloc(4);
    const dyPtr = u.malloc(4);
    const matrixPtr = u.malloc(24);
    try {
      for (const run of suspicious) fixRun(run);
    } finally {
      [xPtr, yPtr, dxPtr, dyPtr, matrixPtr].forEach(u.free);
    }

    /** Tf size × vertical scale of the character matrix (FS_MATRIX {a, b, c, d, e, f} as floats) */
    function effectiveFontSize(charIndex: number, fs: number): number {
      if (!m.FPDFText_GetMatrix(textPagePtr, charIndex, matrixPtr)) return fs;
      const c = m.pdfium.getValue(matrixPtr + 8, 'float');
      const d = m.pdfium.getValue(matrixPtr + 12, 'float');
      return fs * (Math.hypot(c, d) || 1);
    }

    function fixRun(run: PdfRun) {
      const fs = run.fontSize!;
      let minY = Infinity;
      let maxY = -Infinity;
      run.glyphs.forEach((g, i) => {
        if (g.width === 0 && g.height === 0) return;
        const size = effectiveFontSize(run.charStart + i, fs);
        if (g.height <= size * TALL_RATIO && g.height >= size * SHORT_RATIO) return;
        if (!m.FPDFText_GetCharOrigin(textPagePtr, run.charStart + i, xPtr, yPtr)) return;
        // Convert the baseline point to page coordinates with a top-left origin (same transform as readGlyphInfo; rotation is handled too)
        m.FPDF_PageToDevice(
          pagePtr,
          0,
          0,
          page.size.width,
          page.size.height,
          0,
          m.pdfium.getValue(xPtr, 'double'),
          m.pdfium.getValue(yPtr, 'double'),
          dxPtr,
          dyPtr,
        );
        const baseline = m.pdfium.getValue(dyPtr, 'i32');
        g.y = Math.round(baseline - size * ASCENT);
        g.height = Math.round(size);
      });
      for (const g of run.glyphs) {
        if (g.width === 0 && g.height === 0) continue;
        minY = Math.min(minY, g.y);
        maxY = Math.max(maxY, g.y + g.height);
      }
      if (minY !== Infinity) {
        run.rect.y = minY;
        run.rect.height = maxY - minY;
      }
    }
  });
  return geo;
}
