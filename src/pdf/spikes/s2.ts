import type { PdfRuntime } from '../engine';
import { withPage, getDocPtr } from '../raw';
import { addJapaneseTextAnnot, type TextAnnotSubtype } from './text-annot-ja';
import { createFontSubsetter, collectCodepoints } from '../fonts/subset';
import { saveDocument, type SaveMode } from '../save';
import fontUrl from '/fonts/BIZUDPGothic-Regular.ttf?url';

let fontCache: Uint8Array | null = null;
async function loadFont(): Promise<Uint8Array> {
  fontCache ??= new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  return fontCache;
}

/** S2: add one Japanese FreeText. Returns the subset font size (for the S5 measurement) */
export async function s2AddFreeText(
  rt: PdfRuntime,
  docId: string,
  pageIndex: number,
  x: number,
  y: number,
  text: string,
  subtype: TextAnnotSubtype = 'stamp',
) {
  const [font, subsetter] = await Promise.all([loadFont(), createFontSubsetter()]);
  const t0 = performance.now();
  const subset = subsetter.subset(font, collectCodepoints([text]));
  const subsetMs = performance.now() - t0;
  const fontSize = 12;
  const lines = text.split(/\r?\n/).length;
  const docPtr = getDocPtr(rt.native, docId);
  const ok = withPage(rt.native, docId, pageIndex, (pagePtr) =>
    addJapaneseTextAnnot(rt.pdfium, docPtr, pagePtr, {
      subtype,
      rect: { left: x, bottom: y - lines * fontSize * 1.2 - 4, right: x + 200, top: y },
      text,
      fontSize,
      fontData: subset,
    }),
  );
  return { ok, fullBytes: font.byteLength, subsetBytes: subset.byteLength, subsetMs };
}

/** In development, POST to Vite's spike-sink and save under _spike-out/ (for verification). Downloads in production */
export async function s2Save(rt: PdfRuntime, docId: string, mode: SaveMode, name: string) {
  const bytes = saveDocument(rt.pdfium, getDocPtr(rt.native, docId), mode);
  const outName = name.replace(/\.pdf$/i, '') + `_${mode}.pdf`;
  if (import.meta.env.DEV) {
    const r = await fetch(`/__spike/save?name=${encodeURIComponent(outName)}`, {
      method: 'POST',
      body: bytes as BodyInit,
    });
    return `${outName}: ${bytes.byteLength} bytes (${r.status})`;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  a.download = outName;
  a.click();
  URL.revokeObjectURL(a.href);
  return `${outName}: ${bytes.byteLength} bytes`;
}
