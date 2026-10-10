import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, saveVia, selectTool } from './helpers';

type Styled = { type: number; strokeColor?: string; color?: string; strokeWidth?: number };

const annots = (page: Page): Promise<Styled[]> =>
  page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().map((a: { object: Styled }) => ({
      type: a.object.type,
      strokeColor: a.object.strokeColor,
      color: a.object.color,
      strokeWidth: a.object.strokeWidth,
    })),
  );

async function selectAnnotation(page: Page, index: number) {
  await page.evaluate((i) => {
    const a = window.__pdf.annotations;
    const o = a.getAnnotations()[i].object;
    a.selectAnnotation(o.pageIndex, o.id);
  }, index);
  await page.waitForSelector('.annot-menu');
}

async function drawSquare(page: Page, x: number, y: number) {
  await selectTool(page, '四角');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  // Disable the File System Access API to force the download path
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
});

test('四角の色と太さを選択メニューで変えると、次に描く四角の既定になり、再読み込み後も保たれる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  await drawSquare(page, box.x + 300, box.y + 1000);
  expect(await annots(page)).toEqual([{ type: 5, strokeColor: '#E44234', color: 'transparent', strokeWidth: 1.5 }]);

  await selectAnnotation(page, 0);
  // The current color is shown as selected in the grid
  await page.locator('.annot-menu .color-select-btn').click();
  await expect(page.locator('.annot-menu .color-grid button[aria-selected="true"]')).toHaveAttribute(
    'aria-label',
    '赤',
  );
  await page.locator('.annot-menu .color-grid button[aria-label="青"]').click();
  await expect(page.locator('.annot-menu .color-grid')).toHaveCount(0);
  await page.locator('.annot-menu .width-select').selectOption('3');
  await page.waitForTimeout(300);
  // The fill (color) of a shape stays transparent
  expect(await annots(page)).toEqual([{ type: 5, strokeColor: '#1A73E8', color: 'transparent', strokeWidth: 3 }]);

  await drawSquare(page, box.x + 300, box.y + 1150);
  expect((await annots(page))[1]).toMatchObject({ strokeColor: '#1A73E8', strokeWidth: 3 });

  // Saved as the tool default in the settings: a fresh load uses it
  await openPdf(page, 'sample-ja-form.pdf');
  await drawSquare(page, box.x + 300, box.y + 1000);
  expect(await annots(page)).toEqual([{ type: 5, strokeColor: '#1A73E8', color: 'transparent', strokeWidth: 3 }]);

  // The saved file carries the color and width (#1A73E8 = /C [.102 .451 .910], /BS /W 3). PDFium omits the leading 0
  const saved = (await saveVia(page, '注釈付きで保存')).toString('latin1');
  expect(saved).toMatch(/\/C\s*\[\s*0?\.1019\d*\s+0?\.4509\d*\s+0?\.9098\d*\s*\]/);
  expect(saved).toMatch(/\/W\s+3\b/);
});

test('ハイライトは淡い色だけを選べ、太さの欄は出ない', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box, scale } = await pageGeometry(page);

  await selectTool(page, 'ハイライト');
  await page.mouse.move(box.x + 52 * scale, box.y + 316 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 168 * scale, box.y + 316 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await selectAnnotation(page, 0);
  await expect(page.locator('.annot-menu .width-select')).toHaveCount(0);
  await page.locator('.annot-menu .color-select-btn').click();
  await expect(page.locator('.annot-menu .color-grid button')).toHaveCount(5);
  await page.locator('.annot-menu .color-grid button[aria-label="緑"]').click();
  await page.waitForTimeout(300);
  expect(await annots(page)).toEqual([{ type: 9, strokeColor: '#A8E6A1', color: '#A8E6A1', strokeWidth: undefined }]);
});

test('テキストの色は 10 色から選べ、選んだ色で注釈が作られる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  await page.locator('.toolbar button', { hasText: 'テキスト' }).first().click();
  await page.mouse.click(box.x + 320, box.y + 395);
  await page.fill('.popover textarea', '色の確認');
  // Esc closes only the color grid, not the text popover
  await page.locator('.popover .color-select-btn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover .color-grid')).toHaveCount(0);
  await expect(page.locator('.popover textarea')).toHaveValue('色の確認');
  await page.locator('.popover .color-select-btn').click();
  await expect(page.locator('.popover .color-grid button')).toHaveCount(10);
  await page.locator('.popover .color-grid button[aria-label="緑"]').click();
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);

  const colors = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { custom?: { pdfa?: { color: unknown } } } }) => a.object.custom?.pdfa?.color),
  );
  expect(colors).toEqual([{ r: 0x1e, g: 0x8e, b: 0x3e }]);
});

test('付箋の選択メニューには色の欄が出ない', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await selectTool(page, '付箋');
  await page.mouse.click(box.x + 500, box.y + 300);
  await page.waitForSelector('.annot-menu');
  await expect(page.locator('.annot-menu button', { hasText: 'コメント' })).toBeVisible();
  await expect(page.locator('.annot-menu .color-select-btn')).toHaveCount(0);
});
