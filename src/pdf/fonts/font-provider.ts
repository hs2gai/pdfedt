import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { loadJaFontBytes } from './ja-font';
import { guessFontId } from './match';
import type { BundledFontId } from './catalog';

/**
 * Fonts handed to PDFium when it draws non-embedded fonts (FPDF_SYSFONTINFO).
 * EmbedPDF's fontFallback picks by character set only and ignores the font name, so we register our own.
 * PDFium requests synchronously, so the returned bytes must be loaded before opening the document (prepareDisplayFonts).
 *
 * Resolution order: (1) a PC font with a matching name (display only; never written into the saved PDF)
 * → (2) for Japanese (CJK charset), the bundled mincho / gothic based on the name and the Serif flag → (3) otherwise PDFium's built-in fonts.
 */

/** FPDF_SYSFONTINFO from fpdf_sysfontinfo.h (version + 8 function pointers, 4 bytes each) */
const STRUCT_SIZE = 36;
/** FXFONT_FF_ROMAN: pitchFamily bit PDFium sets from the Serif flag */
const PITCH_FAMILY_ROMAN = 1 << 4;
/** fpdf_edit.h: Serif bit of FPDFFont_GetFlags (passed to guessFontId) */
const FONT_FLAG_SERIF = 1 << 1;
/** FX_Charset: CJK charsets. The built-in fonts have no glyphs for these, so always serve them from the bundled fonts */
const CJK_CHARSETS = new Set([128 /* ShiftJIS */, 129 /* Hangul */, 134 /* GB2312 */, 136 /* Big5 */]);

export const normalizeFontName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface FontResolution {
  face: string;
  source: 'local' | BundledFontId | 'builtin';
}

export class FontProvider {
  /** normalized font name → PC font (single TTF) */
  private readonly local = new Map<string, Uint8Array>();
  private readonly bundled = new Map<BundledFontId, Uint8Array>();
  private readonly handles = new Map<number, { data: Uint8Array; charset: number; key: string }>();
  private nextHandle = 1;
  /**
   * While true, return nothing (PDFium falls back to its built-in fonts).
   * PDFium caches substitution results by face name, so if a provisional font is returned during the scan
   * before display fonts are ready (listNonEmbeddedFonts), it can no longer be swapped later.
   */
  suspended = false;
  /** Resolution log (for debugging and E2E) */
  readonly log: FontResolution[] = [];

  constructor(private readonly m: WrappedPdfiumModule) {}

  registerLocal(name: string, data: Uint8Array) {
    this.local.set(normalizeFontName(name), data);
  }

  hasLocal(name: string): boolean {
    return this.local.has(normalizeFontName(name));
  }

  async ensureBundled(id: BundledFontId): Promise<void> {
    if (!this.bundled.has(id)) this.bundled.set(id, await loadJaFontBytes(id));
  }

  /** Register with PDFium. Once, before opening the document */
  install() {
    const rt = this.m.pdfium;
    const ptr = rt.wasmExports.malloc(STRUCT_SIZE) as number;
    const fns = [
      rt.addFunction(() => {}, 'vi'), // Release
      rt.addFunction(() => {}, 'vii'), // EnumFonts
      rt.addFunction(
        // (self, weight, italic, charset, pitchFamily, face, bExact) — bold / italic are synthesized by PDFium, so ignore them
        (_self: number, _weight: number, _italic: number, charset: number, pitchFamily: number, face: number) =>
          this.mapFont(face ? rt.UTF8ToString(face) : '', charset, pitchFamily),
        'iiiiiiii',
      ), // MapFont
      rt.addFunction((_self: number, face: number) => this.mapFont(face ? rt.UTF8ToString(face) : '', 0, 0), 'iii'), // GetFont
      rt.addFunction(
        (_self: number, h: number, table: number, buf: number, size: number) => this.getFontData(h, table, buf, size),
        'iiiiii',
      ), // GetFontData
      rt.addFunction(
        (_self: number, h: number, buf: number, size: number) => this.getFaceName(h, buf, size),
        'iiiii',
      ), // GetFaceName
      rt.addFunction((_self: number, h: number) => this.handles.get(h)?.charset ?? 0, 'iii'), // GetFontCharset
      rt.addFunction((_self: number, h: number) => void this.handles.delete(h), 'vii'), // DeleteFont
    ];
    rt.setValue(ptr, 1, 'i32');
    fns.forEach((fn, i) => rt.setValue(ptr + 4 + i * 4, fn, 'i32'));
    this.m.FPDF_SetSystemFontInfo(ptr);
  }

  private mapFont(face: string, charset: number, pitchFamily: number): number {
    if (this.suspended) return 0;
    const found = this.resolve(face, charset, pitchFamily);
    this.log.push({ face, source: found?.source ?? 'builtin' });
    if (!found) return 0;
    const h = this.nextHandle++;
    this.handles.set(h, { data: found.data, charset, key: `${found.source}:${normalizeFontName(face)}` });
    return h;
  }

  private resolve(face: string, charset: number, pitchFamily: number): { data: Uint8Array; source: 'local' | BundledFontId } | null {
    const local = this.local.get(normalizeFontName(face));
    if (local) return { data: local, source: 'local' };
    if (!CJK_CHARSETS.has(charset)) return null;
    const wanted = guessFontId(face, pitchFamily & PITCH_FAMILY_ROMAN ? FONT_FLAG_SERIF : 0);
    const id = this.bundled.has(wanted) ? wanted : 'gothic';
    const data = this.bundled.get(id);
    return data ? { data, source: id } : null;
  }

  /**
   * PDFium uses the name returned here as the face cache key.
   * Including the source (PC / bundled) prevents the previous face from being reused after changing the setting and reopening.
   */
  private getFaceName(h: number, buf: number, size: number): number {
    const handle = this.handles.get(h);
    if (!handle) return 0;
    const bytes = new TextEncoder().encode(handle.key);
    if (buf === 0 || size < bytes.length) return bytes.length;
    this.m.pdfium.HEAPU8.set(bytes, buf);
    return bytes.length;
  }

  /** table=0 means the whole file. Returning 0 for a specific table makes PDFium fetch the whole file instead */
  private getFontData(h: number, table: number, buf: number, size: number): number {
    const handle = this.handles.get(h);
    if (!handle || table !== 0) return 0;
    if (buf === 0 || size < handle.data.length) return handle.data.length;
    this.m.pdfium.HEAPU8.set(handle.data, buf);
    return handle.data.length;
  }
}
