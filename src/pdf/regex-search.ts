import { MatchFlag, type PdfDocumentObject, type PdfPageObject, type SearchResult } from '@embedpdf/models';
import type { PdfiumNative } from '@embedpdf/engines/pdfium';

/**
 * Regular expression search. PDFium's FPDFText_FindStart only does plain text, so in regex mode
 * the page text is matched with a JS RegExp and the hit ranges go back through PDFium for their rectangles.
 * The mode travels as an extra bit in the search plugin's flags, so the plugin's state, highlights
 * (SearchLayer) and next / previous navigation work unchanged.
 */

/** Our own search flag (outside PDFium's MatchCase / MatchWholeWord / MatchConsecutive bits) */
export const REGEX_FLAG = (1 << 16) as MatchFlag;

/** Hits kept per page; a pattern like "." would otherwise produce one hit per character */
const MAX_MATCHES_PER_PAGE = 1000;

/** Compiles the pattern as the search does (Unicode aware, case-insensitive unless matchCase). Throws on a syntax error */
export function compileSearchRegex(pattern: string, matchCase: boolean): RegExp {
  return new RegExp(pattern, matchCase ? 'gu' : 'giu');
}

/** Returns the error message of an invalid pattern, or null when it compiles */
export function regexError(pattern: string): string | null {
  try {
    compileSearchRegex(pattern, false);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Hit ranges in UTF-16 code units (= PDFium character indices). Empty matches are skipped */
export function findRegexMatches(text: string, re: RegExp, limit = MAX_MATCHES_PER_PAGE): { index: number; length: number }[] {
  const hits: { index: number; length: number }[] = [];
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue;
    hits.push({ index: m.index, length: m[0].length });
    if (hits.length >= limit) break;
  }
  return hits;
}

interface PdfiumModuleLike {
  FPDFText_CountChars(textPage: number): number;
  FPDFText_GetText(textPage: number, start: number, count: number, buf: number): number;
  pdfium: { UTF16ToString(ptr: number): string };
}
interface PageCtx {
  getTextPage(): number;
}
interface DocCtx {
  borrowPage<T>(pageIdx: number, fn: (ctx: PageCtx) => T): T;
}
/** PdfiumNative internals used here (private in TypeScript, present at runtime) */
interface NativeInternals {
  pdfiumModule: PdfiumModuleLike;
  memoryManager: { malloc(size: number): number; free(ptr: number): void };
  getHighlightRects(doc: PdfDocumentObject, page: PdfPageObject, textPage: number, start: number, count: number): SearchResult['rects'];
  buildContext(text: string, start: number, count: number): SearchResult['context'];
  searchAllInPage(doc: PdfDocumentObject, ctx: DocCtx, page: PdfPageObject, keywordPtr: number, flags: number): SearchResult[];
}

/** Routes searches carrying REGEX_FLAG to the RegExp search (both searchInPage and searchBatch go through searchAllInPage) */
export function installRegexSearch(native: PdfiumNative): void {
  const n = native as unknown as NativeInternals;
  const original = n.searchAllInPage.bind(n);
  n.searchAllInPage = (doc, ctx, page, keywordPtr, flags) => {
    if (!(flags & REGEX_FLAG)) return original(doc, ctx, page, keywordPtr, flags);
    const pattern = n.pdfiumModule.pdfium.UTF16ToString(keywordPtr);
    // The plugin re-runs the last query when the flags change, which may be a plain text that is no valid pattern
    if (regexError(pattern) !== null) return [];
    const re = compileSearchRegex(pattern, (flags & MatchFlag.MatchCase) !== 0);
    return ctx.borrowPage(page.index, (pageCtx) => {
      const textPage = pageCtx.getTextPage();
      const text = pageText(n, textPage);
      return findRegexMatches(text, re).map(({ index, length }) => ({
        pageIndex: page.index,
        charIndex: index,
        charCount: length,
        rects: n.getHighlightRects(doc, page, textPage, index, length),
        context: n.buildContext(text, index, length),
      }));
    });
  };
}

function pageText(n: NativeInternals, textPage: number): string {
  const m = n.pdfiumModule;
  const count = m.FPDFText_CountChars(textPage);
  const buf = n.memoryManager.malloc(2 * (count + 1));
  try {
    m.FPDFText_GetText(textPage, 0, count, buf);
    return m.pdfium.UTF16ToString(buf);
  } finally {
    n.memoryManager.free(buf);
  }
}
