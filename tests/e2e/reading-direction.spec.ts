import { test, expect, type Page } from '@playwright/test';
import { openPdf, saveVia, selectTool, dragPt } from './helpers';

// sample-vertical-r2l.pdf: sample-vertical.pdf with /ViewerPreferences << /Direction /R2L >> (right binding) and
// one more column "「テスト」" centered at x = 420 from y = 100 (top-left origin, 12pt, so it ends at y = 160)

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Disable the File System Access API to force the download path
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
});

/** /ViewerPreferences /Direction of a PDF, read by PDFium in the page */
const directionOf = (page: Page, bytes: Buffer) =>
  page.evaluate(
    (data) => {
      const m = window.__pdf.runtime.pdfium;
      const src = new Uint8Array(data);
      const ptr = m.pdfium.wasmExports.malloc(src.length);
      const buf = m.pdfium.wasmExports.malloc(16);
      m.pdfium.HEAPU8.set(src, ptr);
      const doc = m.FPDF_LoadMemDocument(ptr, src.length, '');
      const n = m.FPDF_VIEWERREF_GetName(doc, 'Direction', buf, 16);
      const name = n > 0 ? new TextDecoder().decode(m.pdfium.HEAPU8.slice(buf, buf + n - 1)) : '';
      m.FPDF_CloseDocument(doc);
      m.pdfium.wasmExports.free(ptr);
      m.pdfium.wasmExports.free(buf);
      return name;
    },
    [...bytes],
  );

test('右綴じ（Direction R2L）の縦書きでも、括弧で始まって終わる列の文字が正しい順と向きでコピーできる', async ({
  page,
}) => {
  await openPdf(page, 'sample-vertical-r2l.pdf');
  await dragPt(page, [420, 102], [420, 158], 500);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した文字をコピーしました');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('「テスト」');
});

test('右綴じの縦書きの列に途中まで引いた下線は、なぞった文字に沿った縦線 1 本になる', async ({ page }) => {
  await openPdf(page, 'sample-vertical-r2l.pdf');
  await selectTool(page, '下線');
  // From the opening bracket to "テ" (y 100–124): with the R2L order the bracket came last, so the range ran from
  // "テ" to the end of the column and the line covered all of it
  await dragPt(page, [420, 102], [420, 118], 500);
  const rects = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .flatMap(
        (a: { object: { segmentRects: { origin: { x: number }; size: { width: number; height: number } }[] } }) =>
          a.object.segmentRects.map((r) => [r.origin.x, r.size.width, r.size.height]),
      ),
  );
  expect(rects).toHaveLength(1);
  const [[x, width, height]] = rects;
  // The column only (the next column to the right starts at x = 434), running down it
  expect(x).toBeGreaterThan(405);
  expect(x + width).toBeLessThan(434);
  expect(height).toBeGreaterThan(20);
  expect(height).toBeLessThan(32);
});

test('右綴じの指定は、どの保存でもファイルに残る', async ({ page }) => {
  await openPdf(page, 'sample-vertical-r2l.pdf');
  // While open, the document carries the neutral direction (see src/pdf/reading-direction.ts)
  expect(await directionOf(page, await saveVia(page, '注釈付きで保存'))).toBe('R2L');
  expect(await directionOf(page, await saveVia(page, '新ファイルで保存'))).toBe('R2L');
  expect(await directionOf(page, await saveVia(page, '確定して書き出し'))).toBe('R2L');
  // Still fixed after the saves: the copy comes out right
  await dragPt(page, [420, 102], [420, 158], 500);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した文字をコピーしました');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('「テスト」');
});
