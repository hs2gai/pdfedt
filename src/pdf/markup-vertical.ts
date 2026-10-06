import {
  PdfAnnotationSubtype,
  webColorToPdfColor,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfPageObject,
  type PdfStrikeOutAnnoObject,
  type PdfUnderlineAnnoObject,
} from '@embedpdf/models';
import type { PdfRuntime } from './engine';
import { wasmUtils } from './wasm-utils';
import { withTextPage } from './raw';

/**
 * Underline / strikeout on vertical text (tategaki).
 * EmbedPDF writes every markup quad as an axis-aligned "horizontal" quad, and PDFium's appearance generator
 * draws the underline along the bottom edge and the strikeout across the middle height of each quad.
 * On a vertical column that becomes a short horizontal tick at the bottom / middle. For segments that run
 * down the page, the quad is rewritten with the text flow as its upper edge (the underline side is the
 * right of the column, the Japanese convention for 傍線) and the appearance is drawn here.
 */

/** A markup segment in page space (PDF coordinates, y up) */
export interface PageRect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

interface Point {
  x: number;
  y: number;
}

/** Text flow from the centers of the characters in a segment; null when it cannot be told (fewer than 2) */
export function flowIsVertical(centers: Point[]): boolean | null {
  if (centers.length < 2) return null;
  const xs = centers.map((c) => c.x);
  const ys = centers.map((c) => c.y);
  return Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
}

/**
 * Text flow of a single character. A vertical-mode glyph (WMode 1) has its origin on the horizontal center
 * of its box, a horizontal one at its left edge; text rotated by 90° / 270° flows the other way.
 * `angle` is FPDFText_GetCharAngle (radians)
 */
export function charFlowIsVertical(box: PageRect, origin: Point, angle: number): boolean {
  const centered = Math.abs(origin.x - (box.left + box.right) / 2) < Math.abs(origin.x - box.left);
  const rotated = Math.abs(Math.sin(angle)) > Math.SQRT1_2;
  return centered !== rotated;
}

/**
 * QuadPoints (x1 y1 … x4 y4) in Acrobat's order: upper-left, upper-right, lower-left, lower-right of the text.
 * For vertical text the text runs down the page, so the "upper" edge is the column's left side and
 * the "lower" edge (where viewers draw an underline) its right side
 */
export function markupQuadPoints(r: PageRect, vertical: boolean): number[] {
  return vertical
    ? [r.left, r.top, r.left, r.bottom, r.right, r.top, r.right, r.bottom]
    : [r.left, r.top, r.right, r.top, r.left, r.bottom, r.right, r.bottom];
}

/** Same line width and inset as PDFium's own underline / strikeout appearances */
const LINE_WIDTH = 1;
/**
 * Lines down a vertical column are thinner: they run the whole length of the column, close to the glyphs.
 * The underline sits just inside the right edge, which text-geometry.ts (alignVerticalColumns) places a little
 * beyond the glyphs
 */
const VERTICAL_LINE_WIDTH = 0.75;

/** Appearance stream in page space (FPDFAnnot_SetAP uses the annotation /Rect as the BBox) */
export function markupAppearanceStream(
  kind: 'underline' | 'strikeout',
  segments: { rect: PageRect; vertical: boolean }[],
  color: { r: number; g: number; b: number },
  /** FPDFAnnot_SetAP adds the /GS ExtGState when the annotation's /CA is below 1 */
  withGState: boolean,
): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  const c = (v: number) => n(v / 255);
  const lines = segments.map(({ rect: r, vertical }) => {
    if (vertical) {
      const x = kind === 'underline' ? r.right - VERTICAL_LINE_WIDTH / 2 : (r.left + r.right) / 2;
      return `${VERTICAL_LINE_WIDTH} w ${n(x)} ${n(r.top)} m ${n(x)} ${n(r.bottom)} l S`;
    }
    const y = kind === 'underline' ? r.bottom + LINE_WIDTH : (r.bottom + r.top) / 2;
    return `${LINE_WIDTH} w ${n(r.left)} ${n(y)} m ${n(r.right)} ${n(y)} l S`;
  });
  const gs = withGState ? '/GS gs ' : '';
  return [`q ${gs}${c(color.r)} ${c(color.g)} ${c(color.b)} RG`, ...lines, 'Q'].join('\n');
}

const KINDS: Partial<Record<PdfAnnotationSubtype, 'underline' | 'strikeout'>> = {
  [PdfAnnotationSubtype.UNDERLINE]: 'underline',
  [PdfAnnotationSubtype.STRIKEOUT]: 'strikeout',
};
/** How many chars segmentIsVertical looks past a segment for a neighbour with a box */
const NEIGHBOUR_REACH = 3;
/** fpdf_annot.h */
const FPDF_ANNOT_APPEARANCEMODE_NORMAL = 0;

/**
 * Re-applies the vertical handling after every create / update of an underline or strikeout.
 * Wraps the executor (runtime.native), which runs synchronously inside EmbedPDF's queued task, so the
 * appearance is replaced before anything else (such as rendering the annotation) reads it
 */
export function installVerticalMarkup(runtime: PdfRuntime): void {
  const native = runtime.native;
  const create = native.createPageAnnotation.bind(native);
  native.createPageAnnotation = (doc, page, annotation, context) => {
    const task = create(doc, page, annotation, context);
    afterwards(doc, page, annotation);
    return task;
  };
  const update = native.updatePageAnnotation.bind(native);
  native.updatePageAnnotation = (doc, page, annotation, options) => {
    const task = update(doc, page, annotation, options);
    afterwards(doc, page, annotation);
    return task;
  };

  function afterwards(doc: PdfDocumentObject, page: PdfPageObject, annotation: PdfAnnotationObject) {
    const kind = KINDS[annotation.type];
    // When the call failed the annotation is missing (create) or unchanged (update), and fixMarkup does nothing new
    if (kind) fixMarkup(runtime, doc, page, annotation, kind);
  }
}

function fixMarkup(
  runtime: PdfRuntime,
  doc: PdfDocumentObject,
  page: PdfPageObject,
  annotation: PdfAnnotationObject,
  kind: 'underline' | 'strikeout',
) {
  const m = runtime.pdfium;
  const u = wasmUtils(m);
  withTextPage(runtime.native, doc.id, page.index, (pagePtr, textPage) => {
    const annot = u.withWide(annotation.id, (p) => m.EPDFPage_GetAnnotByName(pagePtr, p));
    if (!annot) return;
    const buf = u.malloc(48);
    const f = (i: number) => m.pdfium.getValue(buf + i * 4, 'float');
    const d = (i: number) => m.pdfium.getValue(buf + i * 8, 'double');
    try {
      const rects: PageRect[] = [];
      for (let i = 0; i < m.FPDFAnnot_CountAttachmentPoints(annot); i++) {
        if (!m.FPDFAnnot_GetAttachmentPoints(annot, i, buf)) continue;
        const xs = [f(0), f(2), f(4), f(6)];
        const ys = [f(1), f(3), f(5), f(7)];
        rects.push({ left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) });
      }
      const segments = rects.map((rect) => ({ rect, vertical: segmentIsVertical(rect) }));
      if (!segments.some((s) => s.vertical)) return;

      segments.forEach((s, i) => {
        markupQuadPoints(s.rect, s.vertical).forEach((v, j) => m.pdfium.setValue(buf + j * 4, v, 'float'));
        m.FPDFAnnot_SetAttachmentPoints(annot, i, buf);
      });
      // FPDFAnnot_GetColor fails once the annotation has an appearance, so take the color from the object
      const { strokeColor, color, opacity } = annotation as PdfUnderlineAnnoObject | PdfStrikeOutAnnoObject;
      const rgb = webColorToPdfColor(strokeColor ?? color ?? '#000000');
      const stream = markupAppearanceStream(kind, segments, { r: rgb.red, g: rgb.green, b: rgb.blue }, (opacity ?? 1) < 1);
      u.withWide(stream, (p) => m.FPDFAnnot_SetAP(annot, FPDF_ANNOT_APPEARANCEMODE_NORMAL, p));
    } finally {
      u.free(buf);
      m.FPDFPage_CloseAnnot(annot);
    }

    /** FPDFText_GetCharBox (left, right, bottom, top as doubles); null for chars without a box */
    function charBox(i: number): PageRect | null {
      if (!m.FPDFText_GetCharBox(textPage, i, buf, buf + 8, buf + 16, buf + 24)) return null;
      const box = { left: d(0), right: d(1), bottom: d(2), top: d(3) };
      return box.right > box.left && box.top > box.bottom ? box : null;
    }
    function center(box: PageRect) {
      return { x: (box.left + box.right) / 2, y: (box.bottom + box.top) / 2 };
    }

    /**
     * Decided by the flow of the characters whose box center lies in the segment, together with the characters just
     * before and after it: on a column the selection breaks into short segments (one glyph, tate-chu-yoko "12" set
     * side by side) whose own characters do not tell, while their neighbours run down the column.
     * The rect's shape when there are no characters
     */
    function segmentIsVertical(rect: PageRect): boolean {
      const hits: { i: number; box: PageRect }[] = [];
      const count = m.FPDFText_CountChars(textPage);
      for (let i = 0; i < count; i++) {
        const box = charBox(i);
        if (!box) continue;
        const { x, y } = center(box);
        if (x >= rect.left && x <= rect.right && y >= rect.bottom && y <= rect.top) hits.push({ i, box });
      }
      // Only neighbours right next to the segment: the one before may be the end of another line or column
      const reach = Math.max(rect.right - rect.left, rect.top - rect.bottom);
      const near = (b: PageRect | null): b is PageRect => {
        if (!b) return false;
        const { x, y } = center(b);
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.bottom - y, 0, y - rect.top);
        return Math.hypot(dx, dy) <= reach;
      };
      /** The nearest char with a box in one direction (PDFium puts boxless generated chars between runs) */
      const step = (from: number, dir: -1 | 1) => {
        for (let i = from + dir, n = 0; i >= 0 && i < count && n < NEIGHBOUR_REACH; i += dir, n++) {
          const box = charBox(i);
          if (box) return box;
        }
        return null;
      };
      const neighbours = hits.length ? [step(hits[0].i, -1), step(hits[hits.length - 1].i, 1)].filter(near) : [];
      const flow = flowIsVertical([...hits.map(({ box }) => box), ...neighbours].map(center));
      if (flow !== null) return flow;
      if (hits.length === 1 && m.FPDFText_GetCharOrigin(textPage, hits[0].i, buf, buf + 8)) {
        return charFlowIsVertical(hits[0].box, { x: d(0), y: d(1) }, m.FPDFText_GetCharAngle(textPage, hits[0].i));
      }
      return rect.top - rect.bottom > rect.right - rect.left;
    }
  });
}
