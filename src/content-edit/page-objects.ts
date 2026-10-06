import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { Rect } from '@embedpdf/models';
import { wasmUtils } from '../pdf/wasm-utils';
import { buildVerticalTextPdf } from '../pdf/vertical-pdf';

/** fpdf_edit.h: FPDF_PAGEOBJ_* */
export type PageObjectType = 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
const OBJ_TYPES: PageObjectType[] = ['unknown', 'text', 'path', 'image', 'shading', 'form'];
const FPDF_FONT_TRUETYPE = 2;
/** fpdf_edit.h: FPDF_TEXTRENDERMODE_FILL_STROKE */
const FPDF_TEXTRENDERMODE_FILL_STROKE = 2;
/** fpdf_edit.h: FPDF_TEXTRENDERMODE_INVISIBLE (e.g. the OCR text layer of scanned PDFs) */
const FPDF_TEXTRENDERMODE_INVISIBLE = 3;
/** fpdf_edit.h: FPDF_FILLMODE_NONE */
const FPDF_FILLMODE_NONE = 0;
/**
 * Marked-content tag on the Form XObjects that hold vertical text written by replaceText.
 * Lets such a form be found again and edited as text (its inner objects are a plain text column)
 */
const VERTICAL_TEXT_MARK = 'PdfuguVerticalText';

/** Object detached from the page (original index and FPDF_PAGEOBJECT) */
export interface RemovedObject {
  index: number;
  obj: number;
}

/** A page object, or (with path) an object nested inside the form at index: the child index at each level */
export interface ObjectRef {
  index: number;
  path?: number[];
}

/** Key of an object in a selection ("3", or "3/0/12" for text inside the form at 3) */
export const objectKey = (ref: ObjectRef): string => [ref.index, ...(ref.path ?? [])].join('/');

/** What an edit changed, for Undo (revert) */
export interface Change {
  /**
   * The original page objects, detached, with the indexes they had (for text inside a form, a copy of the form
   * taken before the edit)
   */
  original: RemovedObject[];
  /** Indexes now holding the result (taken off the page on Undo before the originals go back) */
  added: number[];
}

/** Affine matrix as in FPDFPageObj_GetMatrix */
interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface PageObjectInfo {
  index: number;
  /** Set for text inside a form (Form XObject): index is then the page's form holding it (see ObjectRef) */
  path?: number[];
  type: PageObjectType;
  /** Top-left origin, pt (same coordinate system as EmbedPDF annotations) */
  rect: Rect;
  /** For text */
  text?: string;
  fontSize?: number;
  /** Original font (hint for choosing a similar typeface when replacing) */
  font?: { name: string; flags: number; weight: number };
  /**
   * Vertical text (tategaki): a text object in vertical writing mode, or a form holding vertical text written
   * by an earlier replacement. Replacing keeps it vertical
   */
  vertical?: boolean;
  /**
   * Watermarks, page decorations and invisible objects. Hidden and unselectable in content editing mode
   * unless the user chooses to show them (they get in the way, e.g. leftovers of a Word watermark
   * whose diagonal bounds cover the whole page)
   */
  background: boolean;
  /** A form covering most of the page whose text is listed on its own: neither drawn nor picked */
  container?: boolean;
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
    private readonly pageIndex: number,
    private readonly pageHeight: number,
  ) {
    this.u = wasmUtils(m);
  }

  /**
   * The page's objects, and the text inside its forms (Form XObjects) as objects of their own, so that text can be
   * picked even where the whole page is wrapped in nested forms (books, imposed or pasted PDFs).
   * Such a page-covering form is listed as a container: not drawn or picked, as clicking it would select the page
   */
  list(): PageObjectInfo[] {
    const m = this.m;
    const n = m.FPDFPage_CountObjects(this.pagePtr);
    const out: PageObjectInfo[] = [];
    const textPage = m.FPDFText_LoadPage(this.pagePtr);
    try {
      for (let i = 0; i < n; i++) {
        const obj = m.FPDFPage_GetObject(this.pagePtr, i);
        const type = OBJ_TYPES[m.FPDFPageObj_GetType(obj)] ?? 'unknown';
        const b = this.readBounds(obj) ?? { left: 0, bottom: 0, right: 0, top: 0 };
        const info: PageObjectInfo = {
          index: i,
          type,
          rect: this.toRect(b),
          background: this.isBackground(obj, type),
        };
        // Text comes from the object itself, or from the column inside one of our vertical-text forms
        const textObjs = type === 'text' ? [obj] : this.isVerticalTextForm(obj, type) ? this.innerTextObjects(obj) : [];
        if (textObjs.length) {
          info.text = textObjs.map((o) => this.readText(o, textPage)).join('');
          info.fontSize = this.readFontSize(textObjs[0]);
          info.font = this.readFontInfo(textObjs[0]);
          info.vertical = type === 'form' || this.isVerticalWriting(obj);
        }
        out.push(info);
        if (type === 'form' && !textObjs.length) {
          const inner = this.textInForm(i, obj, textPage);
          info.container = inner.length > 0 && area(info.rect) >= CONTAINER_AREA * this.pageArea();
          out.push(...inner);
        }
      }
    } finally {
      if (textPage) m.FPDFText_ClosePage(textPage);
    }
    return out;
  }

  /** The text objects at every level inside a page's form, with rects mapped to the page through the forms' matrices */
  private textInForm(index: number, form: number, textPage: number): PageObjectInfo[] {
    const m = this.m;
    const out: PageObjectInfo[] = [];
    const walk = (parent: number, path: number[], chain: Matrix[]) => {
      for (let k = 0; k < m.FPDFFormObj_CountObjects(parent); k++) {
        const obj = m.FPDFFormObj_GetObject(parent, k);
        const type = OBJ_TYPES[m.FPDFPageObj_GetType(obj)];
        if (type === 'form') walk(obj, [...path, k], [this.readMatrix(obj), ...chain]);
        if (type !== 'text') continue;
        const b = this.readBounds(obj);
        if (!b) continue;
        const corners = [
          [b.left, b.bottom],
          [b.left, b.top],
          [b.right, b.bottom],
          [b.right, b.top],
        ].map(([x, y]) => chain.reduce((pt, mx) => applyMatrix(mx, pt), { x, y }));
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);
        out.push({
          index,
          path: [...path, k],
          type,
          rect: this.toRect({ left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) }),
          text: this.readText(obj, textPage),
          fontSize: this.readFontSize(obj),
          font: this.readFontInfo(obj),
          vertical: this.isVerticalWriting(obj),
          background: this.isInvisible(obj, type),
        });
      }
    };
    walk(form, [], [this.readMatrix(form)]);
    return out;
  }

  /**
   * Deletes objects. Page objects are detached and kept for Undo; text inside forms is redacted (editForms).
   * Text inside a form that is deleted itself is left to the form
   */
  remove(refs: ObjectRef[]): Change | null {
    const tops = refs.filter((r) => !r.path).map((r) => r.index);
    const nested = refs.filter((r) => r.path && !tops.includes(r.index));
    const change = nested.length ? this.editForms(nested.map((ref) => ({ ref }))) : { original: [], added: [] };
    if (!change) return null;
    // Redaction adds no objects, so the page indexes still hold
    const removed = this.detach(tops);
    if (!removed) {
      this.revert(change);
      return null;
    }
    // The redacted forms (added) are counted after the removal; the originals keep the indexes from before it
    return {
      original: [...change.original, ...removed],
      added: change.added.map((i) => i - tops.filter((t) => t < i).length),
    };
  }

  /** Undo a change: take the added objects off the page (destroyed) and put the originals back */
  revert(change: Change): boolean {
    const current = this.detach(change.added);
    if (!current) return false;
    this.destroy(current);
    return this.restore(change.original);
  }

  /** Release the originals a change keeps for Undo (when the change is dropped from history) */
  discard(change: Change) {
    this.destroy(change.original);
  }

  /**
   * Detach page objects, in descending index order (each removal shifts the later indexes).
   * They are returned rather than destroyed so Undo can restore them (destroy them when no longer needed).
   */
  private detach(indexes: number[]): RemovedObject[] | null {
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

  /** Put objects detached by detach back at their original positions (ascending index order) */
  private restore(removed: RemovedObject[]): boolean {
    const m = this.m;
    for (const { index, obj } of [...removed].sort((a, b) => a.index - b.index)) {
      m.FPDFPage_InsertObjectAtIndex(this.pagePtr, obj, index);
    }
    return !!m.FPDFPage_GenerateContent(this.pagePtr);
  }

  private destroy(removed: RemovedObject[]) {
    removed.forEach(({ obj }) => this.m.FPDFPageObj_Destroy(obj));
  }

  /** Move page objects by a delta (dx, dy) in the top-left origin */
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
   * swap in an object using the given font at the same position, size and color.
   * Vertical text stays vertical: see verticalObject. Text inside a form goes through editForms.
   */
  replaceText(ref: ObjectRef, text: string, fontData: Uint8Array, bold = false): Change | null {
    if (ref.path) return this.rewrite([{ ref, text, fontData, bold }]);
    const m = this.m;
    const old = m.FPDFPage_GetObject(this.pagePtr, ref.index);
    const obj = old ? this.textObject(old, text, fontData, bold) : 0;
    if (!obj) return null;
    m.FPDFPage_InsertObjectAtIndex(this.pagePtr, obj, ref.index);
    if (!m.FPDFPage_RemoveObject(this.pagePtr, old)) return null;
    if (!m.FPDFPage_GenerateContent(this.pagePtr)) return null;
    // The original is kept for Undo (the caller discards it)
    return { original: [{ index: ref.index, obj: old }], added: [ref.index] };
  }

  /**
   * Write text inside forms anew on the page, optionally moved by (dx, dy) in the top-left origin.
   * This is also how such text is moved: the original glyphs cannot leave their form (they may use the form's
   * graphics state resources, which the page does not have), so they are redacted and the text is written again
   */
  rewrite(items: { ref: ObjectRef; text: string; fontData: Uint8Array; bold: boolean; dx?: number; dy?: number }[]): Change | null {
    return this.editForms(
      items.map(({ ref, text, fontData, bold, dx = 0, dy = 0 }) => ({
        ref,
        make: (old: number) => {
          const obj = this.textObject(old, text, fontData, bold);
          if (obj && (dx || dy)) this.m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, dx, -dy);
          return obj;
        },
      })),
    );
  }

  /**
   * Text inside forms: PDFium does not write changes to a form's objects back to the file, but its redaction
   * (EPDFText_RedactInQuads) does, writing the form anew (a form shared with other places is copied first, so those
   * places keep their text). The glyphs of the given text objects are redacted, and the objects made from them
   * (make, in the text's own space) go on the page right above their form.
   * An edited form cannot be turned back, so a copy taken beforehand is kept for Undo
   */
  private editForms(items: { ref: ObjectRef; make?: (old: number) => number }[]): Change | null {
    const m = this.m;
    // Everything is looked up and made before the page changes: redaction rewrites the forms, so object handles
    // inside them do not survive it
    const groups = new Map<number, { text: number; obj: number }[]>();
    for (const { ref, make } of [...items].sort((a, b) => a.ref.index - b.ref.index)) {
      const target = this.resolve(ref);
      const text = target && OBJ_TYPES[m.FPDFPageObj_GetType(target.obj)] === 'text' ? target.obj : 0;
      const obj = text && make ? make(text) : 0;
      if (!target || !text || (make && !obj)) {
        [...groups.values()].flat().forEach((g) => g.obj && m.FPDFPageObj_Destroy(g.obj));
        if (obj) m.FPDFPageObj_Destroy(obj);
        return null;
      }
      // Into page space through the forms holding the text (innermost first)
      if (obj) target.chain.forEach((mx) => transform(m, obj, mx));
      groups.set(ref.index, [...(groups.get(ref.index) ?? []), { text, obj }]);
    }

    const change: Change = { original: [], added: [] };
    // Objects inserted above a form shift the forms after it
    let shift = 0;
    for (const [index, group] of groups) {
      const at = index + shift;
      const copy = this.detachedCopy(at);
      if (!copy || !this.redact(group.map((g) => g.text))) {
        if (copy) m.FPDFPageObj_Destroy(copy);
        for (const [i, rest] of groups) if (i >= index) rest.forEach((g) => g.obj && m.FPDFPageObj_Destroy(g.obj));
        this.revert(change);
        return null;
      }
      const made = group.map((g) => g.obj).filter((o) => o);
      made.forEach((o, k) => m.FPDFPage_InsertObjectAtIndex(this.pagePtr, o, at + 1 + k));
      // detachedCopy reads the content stream, so it must be current before the next form
      m.FPDFPage_GenerateContent(this.pagePtr);
      change.original.push({ index, obj: copy });
      change.added.push(at, ...made.map((_, k) => at + 1 + k));
      shift += made.length;
    }
    return change;
  }

  /** A new text object (or vertical-text form) with the given text, in place of old (see horizontal / verticalObject) */
  private textObject(old: number, text: string, fontData: Uint8Array, bold: boolean): number {
    const type = OBJ_TYPES[this.m.FPDFPageObj_GetType(old)];
    if (this.isVerticalTextForm(old, type) || (type === 'text' && this.isVerticalWriting(old))) {
      return this.verticalObject(old, text, fontData, bold);
    }
    return type === 'text' ? this.horizontalObject(old, text, fontData, bold) : 0;
  }

  /** A horizontal text object with the original's size, matrix and color */
  private horizontalObject(old: number, text: string, fontData: Uint8Array, bold: boolean): number {
    const m = this.m;
    const fontSize = this.readFontSize(old);
    const color = this.readFillColor(old);
    const font = this.u.withBytes(fontData, (p, n) => m.FPDFText_LoadFont(this.docPtr, p, n, FPDF_FONT_TRUETYPE, true));
    if (!font) return 0;
    const obj = m.FPDFPageObj_CreateTextObj(this.docPtr, font, fontSize);
    // The text object holds its own reference to the font
    m.FPDFFont_Close(font);
    if (!obj) return 0;
    this.u.withWide(text, (p) => m.FPDFText_SetText(obj, p));
    m.FPDFPageObj_SetFillColor(obj, color.r, color.g, color.b, color.a);
    if (bold) {
      // No bold faces are bundled, so fake bold with fill + a thin stroke (synthetic bold)
      m.FPDFPageObj_SetStrokeColor(obj, color.r, color.g, color.b, color.a);
      m.FPDFPageObj_SetStrokeWidth(obj, fontSize * 0.03);
      m.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_FILL_STROKE);
    }
    transform(m, obj, this.readMatrix(old));
    return obj;
  }

  /**
   * PDFium can only create horizontal fonts, so the new column is written as a small PDF with a genuine
   * vertical (Identity-V) font and imported as a Form XObject placed with the original matrix.
   * The fontData must have TrueType outlines (hasTrueTypeOutlines)
   */
  private verticalObject(old: number, text: string, fontData: Uint8Array, bold: boolean): number {
    const m = this.m;
    // Size and color come from the text itself (for our forms, the column inside)
    const source = OBJ_TYPES[m.FPDFPageObj_GetType(old)] === 'form' ? this.innerTextObjects(old)[0] : old;
    if (!source) return 0;
    const { r, g, b } = this.readFillColor(source);
    const { pdf, anchor } = buildVerticalTextPdf({
      text,
      fontBytes: fontData,
      fontSize: this.readFontSize(source),
      color: { r, g, b },
      bold,
    });
    const form = this.u.withBytes(pdf, (p, n) => {
      const src = m.FPDF_LoadMemDocument(p, n, '');
      if (!src) return 0;
      try {
        const xobj = m.FPDF_NewXObjectFromPage(this.docPtr, src, 0);
        if (!xobj) return 0;
        const obj = m.FPDF_NewFormObjectFromXObject(xobj);
        m.FPDF_CloseXObject(xobj);
        return obj;
      } finally {
        m.FPDF_CloseDocument(src);
      }
    });
    if (!form) return 0;
    // The column's top center to the origin, then where the original text was. A form we wrote earlier was
    // placed as "-(its anchor), then the text's matrix", so undo its anchor before applying its matrix
    m.FPDFPageObj_Transform(form, 1, 0, 0, 1, -anchor.x, -anchor.y);
    if (source !== old) {
      const previous = this.readAnchor(old);
      if (!previous) {
        m.FPDFPageObj_Destroy(form);
        return 0;
      }
      m.FPDFPageObj_Transform(form, 1, 0, 0, 1, previous.x, previous.y);
    }
    transform(m, form, this.readMatrix(old));
    const mark = m.FPDFPageObj_AddMark(form, VERTICAL_TEXT_MARK);
    m.FPDFPageObjMark_SetFloatParam(this.docPtr, form, mark, 'AnchorX', anchor.x);
    m.FPDFPageObjMark_SetFloatParam(this.docPtr, form, mark, 'AnchorY', anchor.y);
    return form;
  }

  /**
   * A copy of the page object at index, on no page: the page is loaded a second time from its content stream
   * (current, as every edit ends with FPDFPage_GenerateContent) and the object is taken out of that instance
   */
  private detachedCopy(index: number): number {
    const m = this.m;
    const page = m.FPDF_LoadPage(this.docPtr, this.pageIndex);
    if (!page) return 0;
    try {
      // The reloaded page must hold the same objects, or index could point at another one
      if (m.FPDFPage_CountObjects(page) !== m.FPDFPage_CountObjects(this.pagePtr)) return 0;
      const obj = m.FPDFPage_GetObject(page, index);
      const current = m.FPDFPage_GetObject(this.pagePtr, index);
      if (!obj || m.FPDFPageObj_GetType(obj) !== m.FPDFPageObj_GetType(current)) return 0;
      return m.FPDFPage_RemoveObject(page, obj) ? obj : 0;
    } finally {
      m.FPDF_ClosePage(page);
    }
  }

  /**
   * Redacts the glyphs of text objects (inside forms too) in one go. Each glyph is hit with a small square around its
   * center, so the neighbouring glyphs whose boxes merely touch it stay
   */
  private redact(texts: number[]): boolean {
    const m = this.m;
    // A fresh text page: the one cached with the page may predate earlier edits
    const textPage = m.FPDFText_LoadPage(this.pagePtr);
    if (!textPage) return false;
    const targets = new Set(texts);
    const quads: number[][] = [];
    const p = this.u.malloc(32);
    try {
      const d = (o: number) => m.pdfium.getValue(p + o, 'double');
      for (let i = 0; i < m.FPDFText_CountChars(textPage); i++) {
        if (!targets.has(m.FPDFText_GetTextObject(textPage, i))) continue;
        // FPDFText_GetCharBox: left, right, bottom, top
        if (!m.FPDFText_GetCharBox(textPage, i, p, p + 8, p + 16, p + 24)) continue;
        const [left, right, bottom, top] = [d(0), d(8), d(16), d(24)];
        const cx = (left + right) / 2;
        const cy = (bottom + top) / 2;
        const rx = (right - left) * REDACT_CORE;
        const ry = (top - bottom) * REDACT_CORE;
        // FS_QUADPOINTSF: upper-left, upper-right, lower-left, lower-right
        quads.push([cx - rx, cy + ry, cx + rx, cy + ry, cx - rx, cy - ry, cx + rx, cy - ry]);
      }
    } finally {
      this.u.free(p);
      m.FPDFText_ClosePage(textPage);
    }
    if (!quads.length) return false;
    const buf = this.u.malloc(quads.length * 32);
    try {
      quads.flat().forEach((v, i) => m.pdfium.setValue(buf + i * 4, v, 'float'));
      return !!m.EPDFText_RedactInQuads(this.pagePtr, buf, quads.length, true, false);
    } finally {
      this.u.free(buf);
    }
  }

  /** The page object at ref.index, the object ref points to, and the matrices of the forms holding it (innermost first) */
  private resolve(ref: ObjectRef): { top: number; obj: number; chain: Matrix[] } | null {
    const m = this.m;
    const top = m.FPDFPage_GetObject(this.pagePtr, ref.index);
    if (!top) return null;
    let obj = top;
    const chain: Matrix[] = [];
    for (const k of ref.path ?? []) {
      if (OBJ_TYPES[m.FPDFPageObj_GetType(obj)] !== 'form') return null;
      chain.unshift(this.readMatrix(obj));
      obj = m.FPDFFormObj_GetObject(obj, k);
      if (!obj) return null;
    }
    return { top, obj, chain };
  }

  /**
   * Whether a text object is in vertical writing mode (WMode 1). PDFium does not expose the font's WMode, so it is
   * told from the geometry: a vertical glyph hangs below its origin, centered on it, while horizontal text starts at
   * its origin and runs to the right. Bounds are mapped back into the object's own text space (which also undoes
   * rotation and the "1 Tf + scaled Tm" style) and compared in em units.
   * Horizontal text rotated 90° (Latin set sideways in a column) is horizontal here, and is replaced as such.
   */
  private isVerticalWriting(obj: number): boolean {
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

  private isVerticalTextForm(obj: number, type: PageObjectType | undefined): boolean {
    return type === 'form' && this.hasMark(obj, VERTICAL_TEXT_MARK);
  }

  /** The anchor a vertical-text form was placed with (kept in its mark so it can be replaced again) */
  private readAnchor(form: number): { x: number; y: number } | null {
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

  private innerTextObjects(form: number): number[] {
    const m = this.m;
    return Array.from({ length: Math.max(0, m.FPDFFormObj_CountObjects(form)) }, (_, i) => m.FPDFFormObj_GetObject(form, i)).filter(
      (o) => o && OBJ_TYPES[m.FPDFPageObj_GetType(o)] === 'text',
    );
  }

  /**
   * Non-text objects marked as /Artifact (watermarks, backgrounds, header / footer decorations; text there such as
   * page headers stays editable), and objects that draw nothing visible
   */
  private isBackground(obj: number, type: PageObjectType): boolean {
    return (type !== 'text' && this.hasMark(obj, 'Artifact')) || this.isInvisible(obj, type);
  }

  private hasMark(obj: number, name: string): boolean {
    return this.findMark(obj, name) !== 0;
  }

  /** The object's marked-content mark with this name (0 when none) */
  private findMark(obj: number, name: string): number {
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
  private isInvisible(obj: number, type: PageObjectType): boolean {
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
  private readText(obj: number, textPage: number): string {
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

  /** Page-space bounds (y up) to a rect in the top-left origin */
  private toRect(b: { left: number; bottom: number; right: number; top: number }): Rect {
    return { origin: { x: b.left, y: this.pageHeight - b.top }, size: { width: b.right - b.left, height: b.top - b.bottom } };
  }

  private pageArea(): number {
    return this.m.FPDF_GetPageWidthF(this.pagePtr) * this.pageHeight;
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

  /** FPDFPageObj_GetBounds, in the space of the object's parent (the page, or the form holding it) */
  private readBounds(obj: number): { left: number; bottom: number; right: number; top: number } | null {
    const p = this.u.malloc(16);
    try {
      if (!this.m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) return null;
      const [left, bottom, right, top] = [0, 4, 8, 12].map((o) => this.m.pdfium.getValue(p + o, 'float'));
      return { left, bottom, right, top };
    } finally {
      this.u.free(p);
    }
  }

  private readMatrix(obj: number): Matrix {
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
    return this.readColor(obj, 'fill');
  }

  private readStrokeColor(obj: number) {
    return this.readColor(obj, 'stroke');
  }

  private readColor(obj: number, kind: 'fill' | 'stroke') {
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

/** Half the side of the square that redact hits each glyph with, relative to the glyph box */
const REDACT_CORE = 0.15;
/** A form holding text is a container (PageObjectInfo.container) from this share of the page area */
const CONTAINER_AREA = 0.5;

const area = (r: Rect) => r.size.width * r.size.height;

/** The point mapped by the matrix */
function applyMatrix(mx: Matrix, pt: { x: number; y: number }) {
  return { x: mx.a * pt.x + mx.c * pt.y + mx.e, y: mx.b * pt.x + mx.d * pt.y + mx.f };
}

function transform(m: WrappedPdfiumModule, obj: number, mx: Matrix) {
  m.FPDFPageObj_Transform(obj, mx.a, mx.b, mx.c, mx.d, mx.e, mx.f);
}
