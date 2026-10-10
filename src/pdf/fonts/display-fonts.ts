import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from '../wasm-utils';
import type { FontProvider } from './font-provider';
import { guessFontId } from './match';
import { findLocalFont, loadLocalFontFace, localFontCatalogReady } from './local-fonts';

/** FPDFPageObj_GetType */
const OBJ_TEXT = 1;
const OBJ_FORM = 5;
/** Limit the number of scanned pages so large documents do not open slowly (non-embedded fonts are usually shared across the document) */
const MAX_PAGES = 100;

export interface NonEmbeddedFont {
  name: string;
  flags: number;
}

/**
 * Enumerates the non-embedded fonts referenced by the document.
 * PDFium requests fonts synchronously, so the document is read separately with the raw API before EmbedPDF opens it.
 * The caller must keep the FontProvider suspended (this scan also triggers substitution and the result is cached).
 */
export function listNonEmbeddedFonts(m: WrappedPdfiumModule, bytes: Uint8Array): NonEmbeddedFont[] {
  const u = wasmUtils(m);
  const found = new Map<string, NonEmbeddedFont>();
  const visitObject = (obj: number) => {
    const type = m.FPDFPageObj_GetType(obj);
    if (type === OBJ_FORM) {
      const n = m.FPDFFormObj_CountObjects(obj);
      for (let i = 0; i < n; i++) visitObject(m.FPDFFormObj_GetObject(obj, i));
      return;
    }
    if (type !== OBJ_TEXT) return;
    const font = m.FPDFTextObj_GetFont(obj);
    if (!font || m.FPDFFont_GetIsEmbedded(font)) return;
    const len = m.FPDFFont_GetBaseFontName(font, 0, 0);
    if (len <= 0) return;
    const p = u.malloc(len);
    try {
      m.FPDFFont_GetBaseFontName(font, p, len);
      const name = m.pdfium.UTF8ToString(p);
      if (!found.has(name)) found.set(name, { name, flags: m.FPDFFont_GetFlags(font) });
    } finally {
      u.free(p);
    }
  };
  // Give up if it cannot be read (e.g. password protected); display falls back to the bundled fonts
  u.withMemDocument(
    bytes,
    '',
    () => undefined,
    (doc) => {
      const pages = Math.min(m.FPDF_GetPageCount(doc), MAX_PAGES);
      for (let i = 0; i < pages; i++) {
        const page = m.FPDF_LoadPage(doc, i);
        if (!page) continue;
        try {
          const n = m.FPDFPage_CountObjects(page);
          for (let j = 0; j < n; j++) visitObject(m.FPDFPage_GetObject(page, j));
        } finally {
          m.FPDF_ClosePage(page);
        }
      }
    },
  );
  return [...found.values()];
}

/**
 * Prepares the fonts needed for display in the FontProvider before opening the document.
 * With useLocalFonts, preload PC fonts with matching names; if there are mincho fonts, preload the bundled mincho.
 */
export async function prepareDisplayFonts(
  m: WrappedPdfiumModule,
  provider: FontProvider,
  bytes: Uint8Array,
  useLocalFonts: boolean,
): Promise<void> {
  provider.suspended = true;
  let fonts: NonEmbeddedFont[];
  try {
    fonts = listNonEmbeddedFonts(m, bytes);
  } finally {
    provider.suspended = false;
  }
  if (fonts.length === 0) return;
  const tasks: Promise<unknown>[] = [];
  if (fonts.some((f) => guessFontId(f.name, f.flags) === 'mincho')) tasks.push(provider.ensureBundled('mincho'));
  if (useLocalFonts) {
    const catalog = await localFontCatalogReady();
    for (const f of fonts) {
      if (provider.hasLocal(f.name)) continue;
      const local = findLocalFont(f.name, catalog);
      if (local) {
        tasks.push(
          loadLocalFontFace(local).then(
            (data) => provider.registerLocal(f.name, data),
            (e) => console.warn(`Cannot use the PC font for display: ${f.name}`, e),
          ),
        );
      }
    }
  }
  await Promise.all(tasks);
}
