import type { PdfDocumentObject, PdfPageGeometry, PdfPageObject, PdfRun } from '@embedpdf/models';
import { PdfTaskHelper, type PdfTask } from '@embedpdf/models';
import type { PdfEngine } from '@embedpdf/engines/pdfium';
import type { PdfRuntime } from './engine';
import { wasmUtils } from './wasm-utils';
import { withTextPage } from './raw';
import { flowIsVertical } from './markup-vertical';
import { debugEnabled, debugLog } from '../shared/debug';

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

/** Share of the column width added on the right of a vertical column (room for the underline, 傍線) */
const COLUMN_GAP = 0.25;
/** Glyphs PDFium generates (spaces at line breaks); the selection skips them as well */
const GENERATED = 2;

type Glyph = PdfRun['glyphs'][number];
/** A run on a vertical column (see alignVerticalColumns) */
export type VerticalRun = PdfRun & { vertical?: boolean };
const visible = (g: Glyph) => g.flags !== GENERATED && (g.width > 0 || g.height > 0);

/**
 * Vertical text (tategaki): every glyph box of a column gets the same horizontal extent, from the column's left edge
 * to a little beyond its right edge. Selection rects, and the markup made from them, are built from these boxes:
 * without this a column breaks into a zigzag (narrow Latin and punctuation boxes, separate runs per font), and an
 * underline drawn down the right side of the rect lands on the glyphs (the boxes end at the ink, rounded to whole pt).
 * Consecutive runs flowing down the page at about the same x form one column. Horizontal text is left as it is.
 * The runs of a column are marked `vertical`: our patch of @embedpdf/plugin-selection joins them into one rect
 * (never with the next column) and passes the mark on to the rect, where the patched underline / strikeout read it
 */
export function alignVerticalColumns(runs: PdfRun[]): void {
  interface Box {
    run: PdfRun;
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  interface Column {
    boxes: Box[];
    left: number;
    right: number;
    bottom: number;
  }
  // Updated inside add / close, so keep the declared type rather than the narrowed `null`
  let column = null as Column | null;
  // Short runs not part of a column (yet): a column starting right below takes them
  let pending: Box[] = [];
  const width = (b: { left: number; right: number }) => b.right - b.left;
  /** A short run (one glyph, or tate-chu-yoko "40" set side by side) inside the column's width */
  const fits = (b: Box, col: { left: number; right: number }) =>
    width(b) <= width(col) * 1.25 && Math.abs((b.left + b.right) / 2 - (col.left + col.right) / 2) <= width(col) / 2;
  const add = (b: Box) => {
    column ??= { boxes: [], left: b.left, right: b.right, bottom: b.bottom };
    column.boxes.push(b);
    column.left = Math.min(column.left, b.left);
    column.right = Math.max(column.right, b.right);
    column.bottom = Math.max(column.bottom, b.bottom);
  };
  const close = () => {
    if (!column) return;
    const extent = { x: column.left, width: width(column) + Math.ceil(width(column) * COLUMN_GAP) };
    const glyphs = column.boxes.flatMap(({ run }) => run.glyphs.filter(visible)).sort((a, b) => a.y - b.y);
    glyphs.forEach((g, k) => {
      Object.assign(g, extent);
      // Close the small gaps left by rounding where runs meet, so a line down the column does not break there
      const next = glyphs[k + 1];
      const gap = next ? next.y - (g.y + g.height) : 0;
      if (gap > 0 && gap <= width(column!) / 2) g.height += gap;
    });
    for (const { run } of column.boxes) {
      const own = run.glyphs.filter(visible);
      const top = Math.min(...own.map((g) => g.y));
      Object.assign(run.rect, extent, { y: top, height: Math.max(...own.map((g) => g.y + g.height)) - top });
      (run as VerticalRun).vertical = true;
    }
    column = null;
  };
  for (const run of runs) {
    const glyphs = run.glyphs.filter(visible);
    if (!glyphs.length) continue;
    const box: Box = {
      run,
      left: Math.min(...glyphs.map((g) => g.x)),
      right: Math.max(...glyphs.map((g) => g.x + g.width)),
      top: Math.min(...glyphs.map((g) => g.y)),
      bottom: Math.max(...glyphs.map((g) => g.y + g.height)),
    };
    const vertical = flowIsVertical(glyphs.map((g) => ({ x: g.x + g.width / 2, y: g.y + g.height / 2 }))) === true;
    // Continues the current column: about the same x, and starting below (not back at the top of the next column)
    const continues = column !== null && fits(box, column) && box.top >= column.bottom - width(column);
    if (continues) {
      add(box);
    } else if (vertical) {
      close();
      // Short runs right above it (a column opening with a bracket or "30" set side by side) start the column
      pending.filter((p) => fits(p, box) && p.top <= box.top && p.bottom >= box.top - width(box)).forEach(add);
      add(box);
      pending = [];
    } else {
      close();
      pending = [...pending, box];
    }
  }
  close();
}

export function installTextGeometryFix(runtime: PdfRuntime): void {
  const engine = runtime.engine as PdfEngine<Blob>;
  const original = engine.getPageGeometry.bind(engine);
  engine.getPageGeometry = (doc: PdfDocumentObject, page: PdfPageObject): PdfTask<PdfPageGeometry> => {
    const task = PdfTaskHelper.create<PdfPageGeometry>();
    original(doc, page).wait(
      (geo) => {
        const fixed = fixGlyphBoxes(runtime, doc, page, geo);
        const before = debugEnabled() ? describeRuns(fixed.runs) : [];
        alignVerticalColumns(fixed.runs);
        if (before.length) debugLog('geometry', `page ${page.index}`, { before, after: describeRuns(fixed.runs) });
        task.resolve(fixed);
      },
      (e) => task.fail(e),
    );
    return task;
  };
}

/** One line per run: index, first char, glyph count, vertical mark, rect; the glyph boxes of short runs */
function describeRuns(runs: PdfRun[]): string[] {
  return runs.map((r, k) => {
    const head = [k, r.charStart, r.glyphs.length, (r as VerticalRun).vertical ? 'V' : '-', r.rect.x, r.rect.y, r.rect.width, r.rect.height].join(',');
    return r.glyphs.length <= 3 ? `${head} | ${r.glyphs.map((g) => [g.x, g.y, g.width, g.height, g.flags].join(',')).join(' ; ')}` : head;
  });
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
