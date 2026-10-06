import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative, browserImageDataToBlobConverter } from '@embedpdf/engines/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { FontProvider } from './fonts/font-provider';
import { installTextGeometryFix } from './text-geometry';
import { installRegexSearch } from './regex-search';
import { installVerticalMarkup } from './markup-vertical';

/**
 * Holds both EmbedPDF's high-level engine and the raw PDFium module.
 * Display, coordinates and selection are left to the engine (EmbedPDF);
 * "what to write into the PDF and how" — /AP generation for annotations, incremental save, content editing —
 * goes straight to pdfium (the raw API).
 */
export interface PdfRuntime {
  engine: PdfEngine<Blob>;
  native: PdfiumNative;
  pdfium: WrappedPdfiumModule;
  /** Fonts used to display non-embedded fonts (bundled + PC fonts) */
  fonts: FontProvider;
}

export async function createPdfRuntime(): Promise<PdfRuntime> {
  // The WASM is served by Vite from the same origin (satisfies CSP connect-src 'self')
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const pdfium = await init({ wasmBinary });
  // For displaying Japanese PDFs without embedded fonts (old documents, annotations made by macOS Preview, etc.).
  // EmbedPDF's fontFallback fetches fonts from a CDN by default and picks by character set without looking at the font name, so it is not used
  // (P1: zero network traffic). Our own FPDF_SYSFONTINFO returns a PC font / the bundled mincho or gothic based on the font name.
  // Display only; it does not affect the saved PDF.
  const native = new PdfiumNative(pdfium, {});
  const fonts = new FontProvider(pdfium);
  await fonts.ensureBundled('gothic'); // Final fallback for Japanese. PDFium requests fonts synchronously, so preload
  fonts.install();
  const engine = new PdfEngine(native, { imageConverter: browserImageDataToBlobConverter });
  const runtime = { engine, native, pdfium, fonts };
  installTextGeometryFix(runtime);
  installRegexSearch(native);
  installVerticalMarkup(runtime);
  return runtime;
}
