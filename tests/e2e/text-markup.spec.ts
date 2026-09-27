import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, selectTool } from './helpers';

const HIGHLIGHT = 9;

type Seg = { origin: { x: number; y: number }; size: { width: number; height: number } };

/**
 * FontBBox が巨大なフォント（原ノ味ゴシックなど）では PDFium の文字ボックスが隣の行まで伸びる。
 * 補正（src/pdf/text-geometry.ts）により、複数行のハイライトが行ごとの矩形になり高さも文字サイズ程度に収まること
 */
test('複数行のハイライトが行ごとの矩形になる（FontBBox が巨大なフォント）', async ({ page }) => {
  await openPdf(page, 'sample-mixed-lines.pdf');
  const { box, scale } = await pageGeometry(page);

  // 1 行目（ベースライン y=100）の途中から 2 行目（y=112）の途中までなぞる
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
  // 2 つの矩形は縦に重ならない（1 行目の下端 ≤ 2 行目の上端）
  const [a, b] = [...segs].sort((p, q) => p.origin.y - q.origin.y);
  expect(a.origin.y + a.size.height).toBeLessThanOrEqual(b.origin.y + 1);
});
