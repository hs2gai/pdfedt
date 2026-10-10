import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from '../pdf/wasm-utils';
import type { PageObjectInfo } from './page-objects';

/** fpdf_edit.h: FPDF_PAGEOBJ_* */
export type PageObjectType = 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
export const OBJ_TYPES: PageObjectType[] = ['unknown', 'text', 'path', 'image', 'shading', 'form'];
/** fpdf_edit.h: FPDF_TEXTRENDERMODE_INVISIBLE (e.g. the OCR text layer of scanned PDFs) */
const FPDF_TEXTRENDERMODE_INVISIBLE = 3;
/** fpdf_edit.h: FPDF_FILLMODE_NONE */
const FPDF_FILLMODE_NONE = 0;
/**
 * Marked-content tag on the Form XObjects that hold vertical text written by replaceText.
 * Lets such a form be found again and edited as text (its inner objects are a plain text column)
 */
export const VERTICAL_TEXT_MARK = 'PdfuguVerticalText';

/** Affine matrix as in FPDFPageObj_GetMatrix */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Reads properties of page objects (no changes to the page) */
export class ObjectReader {
  private readonly u;

  constructor(private readonly m: WrappedPdfiumModule) {
    this.u = wasmUtils(m);
  }

  /**
   * Whether a text object is in vertical writing mode (WMode 1). PDFium does not expose the font's WMode, so it is
   * told from the geometry: a vertical glyph hangs below its origin, centered on it, while horizontal text starts at
   * its origin and runs to the right. Bounds are mapped back into the object's own text space (which also undoes
   * rotation and the "1 Tf + scaled Tm" style) and compared in em units.
   * Horizontal text rotated 90° (Latin set sideways in a column) is horizontal here, and is replaced as such.
   */
  isVerticalWriting(obj: number): boolean {
    const fontSize = this.readFontSize(obj);
    const { a, b, c, d, e, f } = this.readMatrix(obj);
    const det = a * d - b * c;
    const bounds = this.readBounds(obj);
    if (!fontSize || !det || !bounds) return false;
    const { left, bottom, right, top } = bounds;
    // Local x of the four corners (inverse of the matrix)
    const xs = [
      [left, bottom],
      [left, top],
      [right, bottom],
      [right, top],
    ].map(([x, y]) => (d * (x - e) - c * (y - f)) / det);
    return Math.min(...xs) < -0.25 * fontSize;
  }

  isVerticalTextForm(obj: number, type: PageObjectType | undefined): boolean {
    return type === 'form' && this.hasMark(obj, VERTICAL_TEXT_MARK);
  }

  /** The anchor a vertical-text form was placed with (kept in its mark so it can be replaced again) */
  readAnchor(form: number): { x: number; y: number } | null {
    const m = this.m;
    const mark = this.findMark(form, VERTICAL_TEXT_MARK);
    if (!mark) return null;
    const p = this.u.malloc(4);
    try {
      const read = (key: string) =>
        m.FPDFPageObjMark_GetParamFloatValue(mark, key, p) ? m.pdfium.getValue(p, 'float') : null;
      const x = read('AnchorX');
      const y = read('AnchorY');
      return x === null || y === null ? null : { x, y };
    } finally {
      this.u.free(p);
    }
  }

  innerTextObjects(form: number): number[] {
    const m = this.m;
    return Array.from({ length: Math.max(0, m.FPDFFormObj_CountObjects(form)) }, (_, i) =>
      m.FPDFFormObj_GetObject(form, i),
    ).filter((o) => o && OBJ_TYPES[m.FPDFPageObj_GetType(o)] === 'text');
  }

  /**
   * Non-text objects marked as /Artifact (watermarks, backgrounds, header / footer decorations; text there such as
   * page headers stays editable), and objects that draw nothing visible
   */
  isBackground(obj: number, type: PageObjectType): boolean {
    return (type !== 'text' && this.hasMark(obj, 'Artifact')) || this.isInvisible(obj, type);
  }

  hasMark(obj: number, name: string): boolean {
    return this.findMark(obj, name) !== 0;
  }

  /** The object's marked-content mark with this name (0 when none) */
  findMark(obj: number, name: string): number {
    const m = this.m;
    const n = m.FPDFPageObj_CountMarks(obj);
    if (n <= 0) return 0;
    const len = 256;
    const p = this.u.malloc(len + 4);
    try {
      for (let i = 0; i < n; i++) {
        const mark = m.FPDFPageObj_GetMark(obj, i);
        // The name is UTF-16LE with a terminating NUL
        if (mark && m.FPDFPageObjMark_GetName(mark, p, len, p + len) && m.pdfium.UTF16ToString(p) === name) return mark;
      }
      return 0;
    } finally {
      this.u.free(p);
    }
  }

  /** Only cases that can be decided for sure: invisible text render mode, or every painted part fully transparent */
  isInvisible(obj: number, type: PageObjectType): boolean {
    const m = this.m;
    if (type === 'text') {
      if (m.FPDFTextObj_GetTextRenderMode(obj) === FPDF_TEXTRENDERMODE_INVISIBLE) return true;
      return this.readFillColor(obj).a === 0 && this.readStrokeColor(obj).a === 0;
    }
    if (type !== 'path') return false;
    const p = this.u.malloc(8);
    try {
      if (!m.FPDFPath_GetDrawMode(obj, p, p + 4)) return false;
      const fills = m.pdfium.getValue(p, 'i32') !== FPDF_FILLMODE_NONE && this.readFillColor(obj).a > 0;
      const strokes = m.pdfium.getValue(p + 4, 'i32') !== 0 && this.readStrokeColor(obj).a > 0;
      return !fills && !strokes;
    } finally {
      this.u.free(p);
    }
  }

  /** textPage: the page's FPDF_TEXTPAGE, shared by every object read in one list() */
  readText(obj: number, textPage: number): string {
    const m = this.m;
    const len = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
    if (len <= 0) return '';
    const p = this.u.malloc(len * 2 + 2);
    try {
      m.FPDFTextObj_GetText(obj, textPage, p, len);
      return m.pdfium.UTF16ToString(p);
    } finally {
      this.u.free(p);
    }
  }

  readFontInfo(obj: number): PageObjectInfo['font'] {
    const m = this.m;
    const font = m.FPDFTextObj_GetFont(obj);
    if (!font) return undefined;
    const len = m.FPDFFont_GetBaseFontName(font, 0, 0);
    let name = '';
    if (len > 0) {
      const p = this.u.malloc(len);
      try {
        m.FPDFFont_GetBaseFontName(font, p, len);
        name = m.pdfium.UTF8ToString(p);
      } finally {
        this.u.free(p);
      }
    }
    return { name, flags: m.FPDFFont_GetFlags(font), weight: m.FPDFFont_GetWeight(font) };
  }

  readFontSize(obj: number): number {
    const p = this.u.malloc(4);
    try {
      this.m.FPDFTextObj_GetFontSize(obj, p);
      return this.m.pdfium.getValue(p, 'float');
    } finally {
      this.u.free(p);
    }
  }

  /** FPDFPageObj_GetBounds, in the space of the object's parent (the page, or the form holding it) */
  readBounds(obj: number): { left: number; bottom: number; right: number; top: number } | null {
    const p = this.u.malloc(16);
    try {
      if (!this.m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) return null;
      const [left, bottom, right, top] = [0, 4, 8, 12].map((o) => this.m.pdfium.getValue(p + o, 'float'));
      return { left, bottom, right, top };
    } finally {
      this.u.free(p);
    }
  }

  readMatrix(obj: number): Matrix {
    const p = this.u.malloc(24);
    try {
      this.m.FPDFPageObj_GetMatrix(obj, p);
      const f = (i: number) => this.m.pdfium.getValue(p + i * 4, 'float');
      return { a: f(0), b: f(1), c: f(2), d: f(3), e: f(4), f: f(5) };
    } finally {
      this.u.free(p);
    }
  }

  readFillColor(obj: number) {
    return this.readColor(obj, 'fill');
  }

  readStrokeColor(obj: number) {
    return this.readColor(obj, 'stroke');
  }

  readColor(obj: number, kind: 'fill' | 'stroke') {
    const p = this.u.malloc(16);
    try {
      const get = kind === 'fill' ? this.m.FPDFPageObj_GetFillColor : this.m.FPDFPageObj_GetStrokeColor;
      const ok = get.call(this.m, obj, p, p + 4, p + 8, p + 12);
      const v = (i: number) => this.m.pdfium.getValue(p + i * 4, 'i32');
      return ok ? { r: v(0), g: v(1), b: v(2), a: v(3) } : { r: 0, g: 0, b: 0, a: 255 };
    } finally {
      this.u.free(p);
    }
  }
}
