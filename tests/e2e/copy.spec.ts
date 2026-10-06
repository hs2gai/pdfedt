import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, selectTool } from './helpers';

// sample-scaled-tf.pdf: line 1 "この行は、文字の箱の高さを確かめるための見本です。" at 12pt, x=60, baseline y=100 (top-left origin)

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

/** Drags on the first page between two points given in pt */
async function dragPt(page: Page, from: [number, number], to: [number, number]) {
  const { box, scale } = await pageGeometry(page);
  await page.mouse.move(box.x + from[0] * scale, box.y + from[1] * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * scale, box.y + to[1] * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Size of the PNG on the clipboard and the number of yellowish (highlight) pixels */
const readClipboardImage = (page: Page) =>
  page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await item.getType('image/png'));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let yellow = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] < 150) yellow++;
    return { width: bitmap.width, height: bitmap.height, types: item.types, yellow };
  });

test('文字をなぞって Ctrl+C で選択した文字がコピーされる', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  await dragPt(page, [62, 95], [170, 95]);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した文字をコピーしました');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.startsWith('この行は')).toBe(true);
});

test('何もない所をドラッグした範囲が残り、Ctrl+C で画像としてコピーされる', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  await dragPt(page, [300, 300], [400, 380]);
  await expect(page.locator('.region-select')).toHaveCount(1);

  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した範囲を画像としてコピーしました');
  const img = await readClipboardImage(page);
  expect(img.types).toContain('image/png');
  // 100 x 80 pt at 144 dpi
  expect(img.width).toBe(200);
  expect(img.height).toBe(160);
});

test('範囲の画像には注釈（ハイライト）も写る', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  await selectTool(page, 'ハイライト');
  await dragPt(page, [62, 96], [200, 96]);
  await selectTool(page, '選択');

  await dragPt(page, [40, 70], [300, 115]);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した範囲を画像としてコピーしました');
  const img = await readClipboardImage(page);
  expect(img.yellow).toBeGreaterThan(1000);
});

test('クリックや Esc で範囲が消え、何も選んでいなければ Ctrl+C でコピーしない', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  const { box, scale } = await pageGeometry(page);

  await dragPt(page, [300, 300], [400, 380]);
  await expect(page.locator('.region-select')).toHaveCount(1);
  await page.mouse.click(box.x + 450 * scale, box.y + 500 * scale);
  await expect(page.locator('.region-select')).toHaveCount(0);

  await dragPt(page, [300, 300], [400, 380]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.region-select')).toHaveCount(0);

  await page.keyboard.press('Control+c');
  await page.waitForTimeout(300);
  await expect(page.locator('.status-bar')).toHaveCount(0);
});
