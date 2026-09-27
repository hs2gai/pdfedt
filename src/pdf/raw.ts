import type { PdfiumNative } from '@embedpdf/engines/pdfium';

interface PageCtx {
  pagePtr: number;
  /** FPDF_TEXTPAGE (cached with the same lifetime as the page) */
  getTextPage(): number;
}
interface DocCtx {
  docPtr: number;
  borrowPage<T>(pageIdx: number, fn: (ctx: PageCtx) => T): T;
}

/**
 * Access to the raw pointers of a document opened by EmbedPDF.
 * PdfiumNative.cache is private in TypeScript but exists at runtime.
 * Interim bridge from Phase 0. Replace when a public API becomes available.
 */
function docContext(native: PdfiumNative, docId: string): DocCtx {
  const cache = (native as unknown as { cache: { getContext(id: string): DocCtx | undefined } }).cache;
  const ctx = cache.getContext(docId);
  if (!ctx) throw new Error(`document not open: ${docId}`);
  return ctx;
}

export function getDocPtr(native: PdfiumNative, docId: string): number {
  return docContext(native, docId).docPtr;
}

/** Borrow the same FPDF_PAGE as EmbedPDF's page cache and run fn */
export function withPage<T>(native: PdfiumNative, docId: string, pageIndex: number, fn: (pagePtr: number) => T): T {
  return docContext(native, docId).borrowPage(pageIndex, (ctx) => fn(ctx.pagePtr));
}

/** Borrow the page and its text page and run fn */
export function withTextPage<T>(
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
  fn: (pagePtr: number, textPagePtr: number) => T,
): T {
  return docContext(native, docId).borrowPage(pageIndex, (ctx) => fn(ctx.pagePtr, ctx.getTextPage()));
}
