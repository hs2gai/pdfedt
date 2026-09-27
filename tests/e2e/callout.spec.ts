import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, selectTool } from './helpers';

const STAMP = 13;
type Summary = { type: number; text?: string; callout?: { box: { x: number; y: number }; tip: { x: number; y: number } } };
const summary = (page: import('@playwright/test').Page): Promise<Summary[]> =>
  page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { type: number; custom?: { pdfa?: Summary } } }) => ({
        type: a.object.type,
        text: a.object.custom?.pdfa?.text,
        callout: a.object.custom?.pdfa?.callout,
      })),
  );

/** 引き出し線付きテキスト: 矢印の先 → 文字の位置 の 2 クリックで置き、編集と矢印の先の変更ができる */
test('引き出し線付きテキストを置いて編集できる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  await selectTool(page, '引き出し線');
  await expect(page.locator('.tool-hint')).toContainText('矢印の先');
  await page.mouse.click(box.x + 300, box.y + 250);
  await expect(page.locator('.tool-hint')).toContainText('文字を置く位置');
  await page.mouse.click(box.x + 450, box.y + 150);
  await page.waitForSelector('.popover textarea');
  await page.fill('.popover textarea', 'ここを確認');
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);

  let [a] = await summary(page);
  expect(a.type).toBe(STAMP);
  expect(a.text).toBe('ここを確認');
  // 矢印の先は枠の左下側にある
  expect(a.callout!.tip.x).toBeLessThan(a.callout!.box.x);
  expect(a.callout!.tip.y).toBeGreaterThan(a.callout!.box.y);
  // ツールは 1 回置くと選択に戻る
  await expect(page.locator('.tool-hint')).toHaveCount(0);

  // 矢印の先を右下へ変更 → 枠の位置は変わらず、先だけ右に移る
  const select = () =>
    page.evaluate(() => {
      const a = window.__pdf.annotations;
      const o = a.getAnnotations()[0].object;
      a.selectAnnotation(o.pageIndex, o.id);
    });
  await select();
  await page.locator('.annot-menu button', { hasText: '矢印の先を変更' }).click();
  await page.mouse.click(box.x + 700, box.y + 300);
  await page.waitForTimeout(800);
  [a] = await summary(page);
  expect(a.callout!.tip.x).toBeGreaterThan(a.callout!.box.x);

  // 文字の編集でも引き出し線は保たれる
  await select();
  await page.locator('.annot-menu button', { hasText: '編集' }).click();
  await expect(page.locator('.popover textarea')).toHaveValue('ここを確認');
  await page.fill('.popover textarea', '修正後');
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);
  [a] = await summary(page);
  expect(a.text).toBe('修正後');
  expect(a.callout).toBeTruthy();
});
