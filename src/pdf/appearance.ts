import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';
import { saveDocument } from './save';

const FPDF_FONT_TRUETYPE = 2;
/** fpdf_edit.h: FPDF_FILLMODE_* */
const FILLMODE_NONE = 0;
const FILLMODE_WINDING = 2;

export interface RGB {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
}

export interface Appearance {
  /** A 1-page PDF. Passed to EmbedPDF's Stamp annotation as ctx.data */
  pdf: Uint8Array;
  width: number;
  height: number;
}

/**
 * Canvas for drawing an appearance. Coordinates are pt with a bottom-left origin (same as PDF).
 * Text widths can be measured, so the caller decides the layout.
 */
export interface AppearanceCanvas {
  /** Rendered width of a string (pt). font is a key of spec.fonts (default font when omitted) */
  measure(text: string, fontSize: number, font?: string): number;
  /** Left / right ink extents from the origin (pt). Used for centering (avoids the left-bearing offset) */
  measureBounds(text: string, fontSize: number, font?: string): { left: number; right: number };
  text(text: string, x: number, baselineY: number, fontSize: number, color: RGB, font?: string): void;
  rect(x: number, y: number, w: number, h: number, style: ShapeStyle): void;
  roundRect(x: number, y: number, w: number, h: number, r: number, style: ShapeStyle): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, style: ShapeStyle): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, color: RGB): void;
  /** Polygon (closed). Used for arrow heads etc. */
  polygon(points: { x: number; y: number }[], style: ShapeStyle): void;
}

export interface ShapeStyle {
  stroke?: RGB;
  strokeWidth?: number;
  fill?: RGB;
}

export type Measure = (text: string, fontSize: number, font?: string) => number;

export interface AppearanceSpec {
  /** Default subset TrueType font (must contain every character drawn) */
  fontData: Uint8Array;
  /** Additional typefaces (keys chosen by the caller). Selected via the font argument of text / measure */
  fonts?: Record<string, Uint8Array>;
  /** Measure text widths to decide the size */
  layout(measure: Measure): { width: number; height: number };
  draw(canvas: AppearanceCanvas, size: { width: number; height: number }): void;
}

/**
 * Generates an appearance made of shapes and text as a "single-page PDF".
 * EmbedPDF's annotation plugin accepts a PDF when creating a Stamp and
 * imports that page into the appearance stream (/AP), including resources such as fonts.
 */
export function buildAppearance(m: WrappedPdfiumModule, spec: AppearanceSpec): Appearance {
  const u = wasmUtils(m);
  const doc = m.FPDF_CreateNewDocument();
  if (!doc) throw new Error('FPDF_CreateNewDocument failed');
  try {
    const loadFont = (data: Uint8Array) => {
      const f = u.withBytes(data, (p, n) => m.FPDFText_LoadFont(doc, p, n, FPDF_FONT_TRUETYPE, true));
      if (!f) throw new Error('FPDFText_LoadFont failed');
      return f;
    };
    const defaultFont = loadFont(spec.fontData);
    // Additional typefaces are loaded on first use
    const loaded = new Map<string, number>();
    const fontOf = (key?: string) => {
      const data = key ? spec.fonts?.[key] : undefined;
      if (!data) return defaultFont;
      let f = loaded.get(key!);
      if (!f) {
        f = loadFont(data);
        loaded.set(key!, f);
      }
      return f;
    };
    const bounds = u.malloc(16);
    const objBounds = (obj: number) => {
      m.FPDFPageObj_GetBounds(obj, bounds, bounds + 4, bounds + 8, bounds + 12);
      return { left: m.pdfium.getValue(bounds, 'float'), right: m.pdfium.getValue(bounds + 8, 'float') };
    };
    const measureBounds = (text: string, fontSize: number, font?: string) => {
      const obj = m.FPDFPageObj_CreateTextObj(doc, fontOf(font), fontSize);
      u.withWide(text || ' ', (p) => m.FPDFText_SetText(obj, p));
      const b = objBounds(obj);
      m.FPDFPageObj_Destroy(obj);
      return b;
    };
    const measure: Measure = (text, fontSize, font) => {
      const b = measureBounds(text, fontSize, font);
      return b.right - b.left;
    };
    const size = spec.layout(measure);
    const page = m.FPDFPage_New(doc, 0, size.width, size.height);
    try {
      const applyStyle = (obj: number, style: ShapeStyle) => {
        if (style.stroke) {
          m.FPDFPageObj_SetStrokeColor(obj, style.stroke.r, style.stroke.g, style.stroke.b, 255);
          m.FPDFPageObj_SetStrokeWidth(obj, style.strokeWidth ?? 1);
        }
        if (style.fill) m.FPDFPageObj_SetFillColor(obj, style.fill.r, style.fill.g, style.fill.b, 255);
        m.FPDFPath_SetDrawMode(obj, style.fill ? FILLMODE_WINDING : FILLMODE_NONE, !!style.stroke);
        m.FPDFPage_InsertObject(page, obj);
      };
      try {
        const canvas: AppearanceCanvas = {
          measure,
          measureBounds,
          text(text, x, baselineY, fontSize, color, font) {
            const obj = m.FPDFPageObj_CreateTextObj(doc, fontOf(font), fontSize);
            u.withWide(text || ' ', (p) => m.FPDFText_SetText(obj, p));
            m.FPDFPageObj_SetFillColor(obj, color.r, color.g, color.b, 255);
            m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, baselineY);
            m.FPDFPage_InsertObject(page, obj);
          },
          rect(x, y, w, h, style) {
            applyStyle(m.FPDFPageObj_CreateNewRect(x, y, w, h), style);
          },
          roundRect(x, y, w, h, r, style) {
            const k = 0.5523 * r;
            const obj = m.FPDFPageObj_CreateNewPath(x + r, y);
            m.FPDFPath_LineTo(obj, x + w - r, y);
            m.FPDFPath_BezierTo(obj, x + w - r + k, y, x + w, y + r - k, x + w, y + r);
            m.FPDFPath_LineTo(obj, x + w, y + h - r);
            m.FPDFPath_BezierTo(obj, x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
            m.FPDFPath_LineTo(obj, x + r, y + h);
            m.FPDFPath_BezierTo(obj, x + r - k, y + h, x, y + h - r + k, x, y + h - r);
            m.FPDFPath_LineTo(obj, x, y + r);
            m.FPDFPath_BezierTo(obj, x, y + r - k, x + r - k, y, x + r, y);
            m.FPDFPath_Close(obj);
            applyStyle(obj, style);
          },
          ellipse(cx, cy, rx, ry, style) {
            // Approximate an ellipse with 4 Bézier curves (k = 0.5523)
            const k = 0.5523;
            const obj = m.FPDFPageObj_CreateNewPath(cx + rx, cy);
            m.FPDFPath_BezierTo(obj, cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
            m.FPDFPath_BezierTo(obj, cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
            m.FPDFPath_BezierTo(obj, cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
            m.FPDFPath_BezierTo(obj, cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
            m.FPDFPath_Close(obj);
            applyStyle(obj, style);
          },
          line(x1, y1, x2, y2, width, color) {
            const obj = m.FPDFPageObj_CreateNewPath(x1, y1);
            m.FPDFPath_LineTo(obj, x2, y2);
            applyStyle(obj, { stroke: color, strokeWidth: width });
          },
          polygon(points, style) {
            if (points.length < 2) return;
            const obj = m.FPDFPageObj_CreateNewPath(points[0].x, points[0].y);
            for (const p of points.slice(1)) m.FPDFPath_LineTo(obj, p.x, p.y);
            m.FPDFPath_Close(obj);
            applyStyle(obj, style);
          },
        };
        spec.draw(canvas, size);
      } finally {
        u.free(bounds);
      }
      if (!m.FPDFPage_GenerateContent(page)) throw new Error('FPDFPage_GenerateContent failed');
    } finally {
      m.FPDF_ClosePage(page);
    }
    m.FPDFFont_Close(defaultFont);
    loaded.forEach((f) => m.FPDFFont_Close(f));
    return { pdf: saveDocument(m, doc, 'full'), width: size.width, height: size.height };
  } finally {
    m.FPDF_CloseDocument(doc);
  }
}

// ---------------------------------------------------------------------------
// For text annotations (multi-line, left-aligned text)

export interface TextAppearanceSpec {
  text: string;
  fontSize: number;
  color: RGB;
  fontData: Uint8Array;
  /** Line height (ratio to fontSize) */
  lineHeight?: number;
  padding?: number;
}

/** Ascent of BIZ UDPGothic (ratio to em). Used to compute the baseline position */
export const FONT_ASCENT = 0.88;

export function buildTextAppearance(m: WrappedPdfiumModule, spec: TextAppearanceSpec): Appearance {
  const lineHeight = spec.fontSize * (spec.lineHeight ?? 1.25);
  const padding = spec.padding ?? 2;
  const lines = spec.text.split(/\r?\n/);
  return buildAppearance(m, {
    fontData: spec.fontData,
    layout: (measure) => ({
      width: Math.ceil(Math.max(...lines.map((l) => measure(l, spec.fontSize))) + padding * 2),
      height: Math.ceil(lines.length * lineHeight + padding * 2),
    }),
    draw: (c, { height }) => {
      lines.forEach((line, i) => {
        c.text(
          line,
          padding,
          height - padding - spec.fontSize * FONT_ASCENT - i * lineHeight,
          spec.fontSize,
          spec.color,
        );
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Callout text (equivalent to Acrobat's callout)

export interface CalloutAppearanceSpec extends TextAppearanceSpec {
  /** Arrow tip. Relative to the top-left of the text box (pt, y pointing down) */
  tip: { x: number; y: number };
  borderWidth?: number;
}

export interface CalloutAppearance extends Appearance {
  /** Top-left of the text box (relative to the appearance's top-left, pt, y pointing down) */
  box: { x: number; y: number };
}

const ARROW_LEN = 7;
const ARROW_HALF = 3;

/**
 * Framed text + a leader line from the middle of a frame edge to the arrow tip.
 * The appearance size is "frame ∪ arrow tip (+ margin)"; the frame position is returned as box.
 */
export function buildCalloutAppearance(m: WrappedPdfiumModule, spec: CalloutAppearanceSpec): CalloutAppearance {
  const bw = spec.borderWidth ?? 1;
  const lineHeight = spec.fontSize * (spec.lineHeight ?? 1.25);
  const padding = (spec.padding ?? 2) + bw;
  const lines = spec.text.split(/\r?\n/);
  const margin = ARROW_HALF + bw;
  // The frame position decided in layout is used in draw
  let boxW = 0;
  let boxH = 0;
  let box = { x: 0, y: 0 };
  const appearance = buildAppearance(m, {
    fontData: spec.fontData,
    layout: (measure) => {
      boxW = Math.ceil(Math.max(...lines.map((l) => measure(l, spec.fontSize))) + padding * 2);
      boxH = Math.ceil(lines.length * lineHeight + padding * 2);
      const minX = Math.min(0, spec.tip.x - margin);
      const minY = Math.min(0, spec.tip.y - margin);
      const maxX = Math.max(boxW, spec.tip.x + margin);
      const maxY = Math.max(boxH, spec.tip.y + margin);
      box = { x: -minX, y: -minY };
      return { width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
    },
    draw: (c, { height }) => {
      // From here on, PDF coordinates (bottom-left origin)
      const toPdf = (x: number, y: number) => ({ x: box.x + x, y: height - (box.y + y) });
      const color = spec.color;
      const tip = toPdf(spec.tip.x, spec.tip.y);
      // Leader start: the middle of the edge closest to the arrow tip
      const start =
        spec.tip.x < 0
          ? toPdf(0, boxH / 2)
          : spec.tip.x > boxW
            ? toPdf(boxW, boxH / 2)
            : spec.tip.y < 0
              ? toPdf(boxW / 2, 0)
              : toPdf(boxW / 2, boxH);
      const dx = tip.x - start.x;
      const dy = tip.y - start.y;
      const len = Math.hypot(dx, dy);
      if (len > ARROW_LEN) {
        const ux = dx / len;
        const uy = dy / len;
        // Shorten the line by the arrow head and draw a filled triangle at the tip
        c.line(start.x, start.y, tip.x - ux * ARROW_LEN * 0.6, tip.y - uy * ARROW_LEN * 0.6, bw, color);
        const bx = tip.x - ux * ARROW_LEN;
        const by = tip.y - uy * ARROW_LEN;
        c.polygon(
          [
            { x: tip.x, y: tip.y },
            { x: bx - uy * ARROW_HALF, y: by + ux * ARROW_HALF },
            { x: bx + uy * ARROW_HALF, y: by - ux * ARROW_HALF },
          ],
          { fill: color },
        );
      }
      const bl = toPdf(0, boxH);
      c.rect(bl.x + bw / 2, bl.y + bw / 2, boxW - bw, boxH - bw, { stroke: color, strokeWidth: bw });
      lines.forEach((line, i) => {
        const p = toPdf(padding, padding + spec.fontSize * FONT_ASCENT + i * lineHeight);
        c.text(line, p.x, p.y, spec.fontSize, color);
      });
    },
  });
  return { ...appearance, box };
}
