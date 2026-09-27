import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { Rect } from '@embedpdf/models';
import { wasmUtils } from '../pdf/wasm-utils';

/** fpdf_edit.h: FPDF_PAGEOBJ_* */
export type PageObjectType = 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
const OBJ_TYPES: PageObjectType[] = ['unknown', 'text', 'path', 'image', 'shading', 'form'];
const FPDF_FONT_TRUETYPE = 2;
/** fpdf_edit.h: FPDF_TEXTRENDERMODE_FILL_STROKE */
const FPDF_TEXTRENDERMODE_FILL_STROKE = 2;

/** Object detached from the page (original index and FPDF_PAGEOBJECT) */
export interface RemovedObject {
  index: number;
  obj: number;
}

export interface PageObjectInfo {
  index: number;
  type: PageObjectType;
  /** Top-left origin, pt (same coordinate system as EmbedPDF annotations) */
  rect: Rect;
  /** For text */
  text?: string;
  fontSize?: number;
  /** Original font (hint for choosing a similar typeface when replacing) */
  font?: { name: string; flags: number; weight: number };
}

/**
 * Handles the page's own objects (content editing mode only).
 * FPDFPage_GenerateContent is required after changes, and it rewrites the page's content stream.
 */
export class PageObjects {
  private readonly u;

  constructor(
    private readonly m: WrappedPdfiumModule,
    private readonly docPtr: number,
    private readonly pagePtr: number,
    private readonly pageHeight: number,
  ) {
    this.u = wasmUtils(m);
  }

  list(): PageObjectInfo[] {
    const m = this.m;
    const n = m.FPDFPage_CountObjects(this.pagePtr);
    const out: PageObjectInfo[] = [];
    const buf = this.u.malloc(16);
    try {
      for (let i = 0; i < n; i++) {
        const obj = m.FPDFPage_GetObject(this.pagePtr, i);
        const type = OBJ_TYPES[m.FPDFPageObj_GetType(obj)] ?? 'unknown';
        m.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12);
        const f = (o: number) => m.pdfium.getValue(buf + o, 'float');
        const [left, bottom, right, top] = [f(0), f(4), f(8), f(12)];
        const info: PageObjectInfo = {
          index: i,
          type,
          rect: { origin: { x: left, y: this.pageHeight - top }, size: { width: right - left, height: top - bottom } },
        };
        if (type === 'text') {
          info.text = this.readText(obj);
          info.fontSize = this.readFontSize(obj);
          info.font = this.readFontInfo(obj);
        }
        out.push(info);
      }
    } finally {
      this.u.free(buf);
    }
    return out;
  }

  /**
   * Delete in descending index order (each deletion shifts the later indexes).
   * Detached objects are returned rather than destroyed so Undo can restore them (destroy them when no longer needed).
   */
  remove(indexes: number[]): RemovedObject[] | null {
    const m = this.m;
    const removed: RemovedObject[] = [];
    for (const i of [...indexes].sort((a, b) => b - a)) {
      const obj = m.FPDFPage_GetObject(this.pagePtr, i);
      if (!obj || !m.FPDFPage_RemoveObject(this.pagePtr, obj)) return null;
      removed.push({ index: i, obj });
    }
    if (!m.FPDFPage_GenerateContent(this.pagePtr)) return null;
    return removed.reverse();
  }

  /** Put objects detached by remove back at their original positions (ascending index order) */
  restore(removed: RemovedObject[]): boolean {
    const m = this.m;
    for (const { index, obj } of [...removed].sort((a, b) => a.index - b.index)) {
      m.FPDFPage_InsertObjectAtIndex(this.pagePtr, obj, index);
    }
    return !!m.FPDFPage_GenerateContent(this.pagePtr);
  }

  destroy(removed: RemovedObject[]) {
    removed.forEach(({ obj }) => this.m.FPDFPageObj_Destroy(obj));
  }

  /** Move by a delta (dx, dy) in the top-left origin */
  move(indexes: number[], dx: number, dy: number): boolean {
    const m = this.m;
    for (const i of indexes) {
      const obj = m.FPDFPage_GetObject(this.pagePtr, i);
      if (!obj) return false;
      m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, dx, -dy);
    }
    return !!m.FPDFPage_GenerateContent(this.pagePtr);
  }

  /**
   * Replace the text of a text object.
   * The original font usually lacks the new characters (it is a subset), so
   * swap in an object using a bundled font at the same position, size and color.
   */
  replaceText(index: number, text: string, fontData: Uint8Array, bold = false): RemovedObject | null {
    const m = this.m;
    const old = m.FPDFPage_GetObject(this.pagePtr, index);
    if (!old || m.FPDFPageObj_GetType(old) !== 1) return null;
    const fontSize = this.readFontSize(old);
    const matrix = this.readMatrix(old);
    const color = this.readFillColor(old);

    const font = this.u.withBytes(fontData, (p, n) => m.FPDFText_LoadFont(this.docPtr, p, n, FPDF_FONT_TRUETYPE, true));
    if (!font) return null;
    const obj = m.FPDFPageObj_CreateTextObj(this.docPtr, font, fontSize);
    this.u.withWide(text, (p) => m.FPDFText_SetText(obj, p));
    m.FPDFPageObj_SetFillColor(obj, color.r, color.g, color.b, color.a);
    if (bold) {
      // No bold faces are bundled, so fake bold with fill + a thin stroke (synthetic bold)
      m.FPDFPageObj_SetStrokeColor(obj, color.r, color.g, color.b, color.a);
      m.FPDFPageObj_SetStrokeWidth(obj, fontSize * 0.03);
      m.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_FILL_STROKE);
    }
    m.FPDFPageObj_Transform(obj, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    // Insert at the original position (drawing order), then remove the original
    m.FPDFPage_InsertObjectAtIndex(this.pagePtr, obj, index);
    if (!m.FPDFPage_RemoveObject(this.pagePtr, old)) return null;
    m.FPDFFont_Close(font);
    if (!m.FPDFPage_GenerateContent(this.pagePtr)) return null;
    // Return the original object for Undo (the caller destroys it)
    return { index, obj: old };
  }

  private readText(obj: number): string {
    const m = this.m;
    const textPage = m.FPDFText_LoadPage(this.pagePtr);
    try {
      const len = m.FPDFTextObj_GetText(obj, textPage, 0, 0);
      if (len <= 0) return '';
      const p = this.u.malloc(len * 2 + 2);
      try {
        m.FPDFTextObj_GetText(obj, textPage, p, len);
        return m.pdfium.UTF16ToString(p);
      } finally {
        this.u.free(p);
      }
    } finally {
      m.FPDFText_ClosePage(textPage);
    }
  }

  private readFontInfo(obj: number): PageObjectInfo['font'] {
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

  private readFontSize(obj: number): number {
    const p = this.u.malloc(4);
    try {
      this.m.FPDFTextObj_GetFontSize(obj, p);
      return this.m.pdfium.getValue(p, 'float');
    } finally {
      this.u.free(p);
    }
  }

  private readMatrix(obj: number) {
    const p = this.u.malloc(24);
    try {
      this.m.FPDFPageObj_GetMatrix(obj, p);
      const f = (i: number) => this.m.pdfium.getValue(p + i * 4, 'float');
      return { a: f(0), b: f(1), c: f(2), d: f(3), e: f(4), f: f(5) };
    } finally {
      this.u.free(p);
    }
  }

  private readFillColor(obj: number) {
    const p = this.u.malloc(16);
    try {
      const ok = this.m.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12);
      const v = (i: number) => this.m.pdfium.getValue(p + i * 4, 'i32');
      return ok ? { r: v(0), g: v(1), b: v(2), a: v(3) } : { r: 0, g: 0, b: 0, a: 255 };
    } finally {
      this.u.free(p);
    }
  }
}
