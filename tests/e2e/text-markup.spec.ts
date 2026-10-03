import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, selectTool } from './helpers';

const HIGHLIGHT = 9;

type Seg = { origin: { x: number; y: number }; size: { width: number; height: number } };

/**
 * With fonts that have a huge FontBBox (e.g. Harano Aji Gothic), PDFium's char boxes extend into adjacent lines.
 * The correction (src/pdf/text-geometry.ts) makes a multi-line highlight one rect per line, about the font size in height
 */
test('複数行のハイライトが行ごとの矩形になる（FontBBox が巨大なフォント）', async ({ page }) => {
  await openPdf(page, 'sample-mixed-lines.pdf');
  const { box, scale } = await pageGeometry(page);

  // Drag from the middle of line 1 (baseline y=100) to the middle of line 2 (y=112)
  await selectTool(page, 'ハイライト');
  await page.mouse.move(box.x + 200 * scale, box.y + 96 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 300 * scale, box.y + 108 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  const annots: { type: number; segs: Seg[] }[] = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { type: number; segmentRects: Seg[] } }) => ({ type: a.object.type, segs: a.object.segmentRects })),
  );
  expect(annots).toHaveLength(1);
  expect(annots[0].type).toBe(HIGHLIGHT);
  const segs = annots[0].segs;
  expect(segs).toHaveLength(2);
  for (const s of segs) expect(s.size.height).toBeLessThanOrEqual(12);
  // The two rects do not overlap vertically (bottom of line 1 <= top of line 2)
  const [a, b] = [...segs].sort((p, q) => p.origin.y - q.origin.y);
  expect(a.origin.y + a.size.height).toBeLessThanOrEqual(b.origin.y + 1);
});

/**
 * PDFs that set "1 Tf" and put the real size in the text matrix (Word + Acrobat PDFMaker) get 1pt char boxes
 * from PDFium. The correction scales them by the matrix, so the highlight covers the 12pt characters
 */
test('「1 Tf」＋テキスト行列で拡大した文字でもハイライトが文字の高さになる', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  const { box, scale } = await pageGeometry(page);

  // Line 1: 12pt, baseline y=100 (top-left origin)
  await selectTool(page, 'ハイライト');
  await page.mouse.move(box.x + 80 * scale, box.y + 96 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 * scale, box.y + 96 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  const segs: Seg[] = await page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().flatMap((a: { object: { segmentRects: Seg[] } }) => a.object.segmentRects),
  );
  expect(segs).toHaveLength(1);
  expect(segs[0].size.height).toBeGreaterThanOrEqual(10);
  expect(segs[0].size.height).toBeLessThanOrEqual(14);
  // The rect covers the baseline and does not reach line 2 (baseline y=118, top about 107)
  expect(segs[0].origin.y).toBeLessThan(100);
  expect(segs[0].origin.y + segs[0].size.height).toBeGreaterThanOrEqual(100);
  expect(segs[0].origin.y + segs[0].size.height).toBeLessThanOrEqual(107);
});
