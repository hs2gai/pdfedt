import type { PdfDocumentObject, PdfPageGeometry, PdfPageObject, PdfRun } from '@embedpdf/models';
import { PdfTaskHelper, type PdfTask } from '@embedpdf/models';
import type { PdfEngine } from '@embedpdf/engines/pdfium';
import type { PdfRuntime } from './engine';
import { wasmUtils } from './wasm-utils';
import { withTextPage } from './raw';

/**
 * Correction of character rectangles (the basis of selection, highlight, underline and strikeout).
 * EmbedPDF uses FPDFText_GetLooseCharBox, but that box is built from the font-wide FontBBox, so
 * Latin text set in a CJK font (e.g. "Linux" in Harano Aji) gets a 29pt box for 10pt characters,
 * overlapping the neighboring line vertically so lines merge or an underline covers the next line.
 * Only boxes clearly too tall for the font size are replaced with a 1 em box based on the baseline.
 */

/** Boxes taller than this (relative to the font size) are treated as abnormal. Normal Japanese boxes are 0.9–1.1× */
const TALL_RATIO = 1.6;
/** Replacement box: 0.88 em above and 0.12 em below the baseline (typical ascent / descent of Japanese fonts) */
const ASCENT = 0.88;

export function installTextGeometryFix(runtime: PdfRuntime): void {
  const engine = runtime.engine as PdfEngine<Blob>;
  const original = engine.getPageGeometry.bind(engine);
  engine.getPageGeometry = (doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageGeometry> => {
    const task = PdfTaskHelper.create<PdfPageGeometry>();
    original(doc, page).wait(
      (geo) => task.resolve(fixTallGlyphs(runtime, doc, page, geo)),
      (e) => task.fail(e),
    );
    return task;
  };
}

function fixTallGlyphs(runtime: PdfRuntime, doc: PdfDocumentObject, page: PdfPageObject, geo: PdfPageGeometry): PdfPageGeometry {
  const suspicious = geo.runs.filter((run) => {
    const fs = run.fontSize ?? 0;
    return fs > 0 && run.glyphs.some((g) => g.height > fs * TALL_RATIO);
  });
  if (suspicious.length === 0) return geo;

  const m = runtime.pdfium;
  const u = wasmUtils(m);
  withTextPage(runtime.native, doc.id, page.index, (pagePtr, textPagePtr) => {
    const xPtr = u.malloc(8);
    const yPtr = u.malloc(8);
    const dxPtr = u.malloc(4);
    const dyPtr = u.malloc(4);
    try {
      for (const run of suspicious) fixRun(run);
    } finally {
      [xPtr, yPtr, dxPtr, dyPtr].forEach(u.free);
    }

    function fixRun(run: PdfRun) {
      const fs = run.fontSize!;
      let minY = Infinity;
      let maxY = -Infinity;
      run.glyphs.forEach((g, i) => {
        if (g.height <= fs * TALL_RATIO) return;
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
        g.y = Math.round(baseline - fs * ASCENT);
        g.height = Math.round(fs);
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
