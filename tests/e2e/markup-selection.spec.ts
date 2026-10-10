import { test, expect } from '@playwright/test';
import { annotationTypes, dragPt, openPdf, selectTool } from './helpers';

const HIGHLIGHT = 9;
const UNDERLINE = 10;
const STRIKEOUT = 12;

/** "上記のとおり申請します。" on sample-ja-form.pdf (pt, top-left origin) */
const LINE: [[number, number], [number, number]] = [
  [52, 313],
  [104, 313],
];

test('選択ツールで文字を選ぶとポップアップが出て、ハイライト・下線・取消線を付けられる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const menu = page.locator('.text-selection-menu');
  // Separate stretches of the line: pressing on a mark selects that annotation instead of the text under it
  const stretches: [number, number][] = [
    [52, 75],
    [85, 108],
    [118, 141],
  ];
  for (const [i, label] of ['ハイライト', '下線', '取消線'].entries()) {
    const [from, to] = stretches[i];
    await dragPt(page, [from, LINE[0][1]], [to, LINE[0][1]]);
    await expect(menu).toBeVisible();
    await menu.locator(`button[aria-label="${label}"]`).click();
    // The selection is used up, so the popup goes away
    await expect(menu).toHaveCount(0);
  }
  await expect.poll(() => annotationTypes(page)).toEqual([HIGHLIGHT, UNDERLINE, STRIKEOUT]);
  // The tool stays "select"
  await expect(page.locator('.toolbar .icon-btn.active[aria-label="選択"]')).toHaveCount(1);
});

test('文字を選んでからツールバーの下線を押すと、選んだ文字に下線が付き、ツールは選択のまま', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  await dragPt(page, ...LINE);
  await expect(page.locator('.text-selection-menu')).toBeVisible();
  await selectTool(page, '下線');
  await expect.poll(() => annotationTypes(page)).toEqual([UNDERLINE]);
  await expect(page.locator('.toolbar .icon-btn.active[aria-label="選択"]')).toHaveCount(1);
  // The marker group now shows the kind used last
  await expect(page.locator('.toolbar .tool-group .icon-btn[aria-label="下線"]')).toHaveCount(1);
  await expect(page.locator('.text-selection-menu')).toHaveCount(0);
});

test('文字を選ばずにツールバーの取消線を押すとなぞりモードになり、なぞった文字に取消線が付く', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  await selectTool(page, '取消線');
  await expect(page.locator('.toolbar .icon-btn.active[aria-label="取消線"]')).toHaveCount(1);
  await dragPt(page, ...LINE, 800);
  expect(await annotationTypes(page)).toEqual([STRIKEOUT]);
});

test('なぞっている間は選択ツールと同じく選択範囲が表示される', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  await selectTool(page, 'ハイライト');
  const before = await page.locator('.page').first().boundingBox();
  const scale = before!.width / 595.28;
  await page.mouse.move(before!.x + LINE[0][0] * scale, before!.y + LINE[0][1] * scale);
  await page.mouse.down();
  await page.mouse.move(before!.x + LINE[1][0] * scale, before!.y + LINE[1][1] * scale, { steps: 8 });
  // The selection layer draws the selected glyph rects (its blue) while the pointer is still down
  const rects = await page.evaluate(
    () =>
      [...document.querySelectorAll('.page div')].filter(
        (d) => getComputedStyle(d).backgroundColor === 'rgb(33, 150, 243)',
      ).length,
  );
  await page.mouse.up();
  expect(rects).toBeGreaterThan(0);
});
