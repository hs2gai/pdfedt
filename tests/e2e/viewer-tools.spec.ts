import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, selectTool } from './helpers';

// sample-pages.pdf: 3 A4 pages whose text is "ページA" / "ページB" / "ページC"

const currentPage = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const id = window.__pdf.docs.getActiveDocument().id;
    return window.__pdf.scrollCap.forDocument(id).getCurrentPage();
  });

test('ページ番号を入れて Enter でそのページへ移動し、スクロールに合わせて表示が変わる', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  const input = page.locator('.page-nav input');
  await expect(input).toHaveValue('1');
  await expect(page.locator('.page-total')).toHaveText('/ 3');

  await input.fill('3');
  await input.press('Enter');
  await expect.poll(() => currentPage(page)).toBe(3);
  await expect(input).toHaveValue('3');

  // Out of range goes to the last / first page; full-width digits work too
  await input.fill('99');
  await input.press('Enter');
  await expect(input).toHaveValue('3');
  await input.fill('１');
  await input.press('Enter');
  await expect.poll(() => currentPage(page)).toBe(1);

  // Scrolling (here via the thumbnails) updates the number
  await page.locator('.thumb').nth(1).click();
  await expect(input).toHaveValue('2');
});

test('Ctrl+F で検索バーを開き、日本語の一致をハイライトして前後に移動できる', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await page.keyboard.press('Control+f');
  const input = page.locator('.search-bar input');
  await expect(input).toBeFocused();

  await input.fill('ページ');
  await expect(page.locator('.search-status')).toHaveText('1 / 3 件');
  await expect(page.locator('.search-layer > div')).not.toHaveCount(0);

  // Enter = next (the view follows), Shift+Enter = previous, wrapping around
  await input.press('Enter');
  await expect(page.locator('.search-status')).toHaveText('2 / 3 件');
  await expect.poll(() => currentPage(page)).toBe(2);
  await input.press('Shift+Enter');
  await input.press('Shift+Enter');
  await expect(page.locator('.search-status')).toHaveText('3 / 3 件');
  await expect.poll(() => currentPage(page)).toBe(3);

  await input.fill('ページB');
  await expect(page.locator('.search-status')).toHaveText('1 / 1 件');
  await expect.poll(() => currentPage(page)).toBe(2);

  await input.fill('見当たらない文字');
  await expect(page.locator('.search-status')).toHaveText('見つかりません');

  // Esc closes the bar and removes the highlights
  await input.fill('ページ');
  await expect(page.locator('.search-status')).toHaveText('1 / 3 件');
  await input.press('Escape');
  await expect(page.locator('.search-bar')).toHaveCount(0);
  await expect(page.locator('.search-layer')).toHaveCount(0);
});

test('検索バーの .* で正規表現、Aa で大文字小文字の区別に切り替えられ、閉じても設定が残る', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await page.keyboard.press('Control+f');
  const input = page.locator('.search-bar input');
  const status = page.locator('.search-status');
  const regex = page.getByRole('button', { name: '正規表現' });
  const matchCase = page.getByRole('button', { name: '大文字と小文字を区別' });

  // Plain search treats the brackets literally
  await input.fill('ページ[AC]');
  await expect(status).toHaveText('見つかりません');
  await regex.click();
  await expect(regex).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toBeFocused();
  await expect(status).toHaveText('1 / 2 件');
  await input.press('Enter');
  await expect.poll(() => currentPage(page)).toBe(3);

  // A half-typed pattern shows an error instead of searching
  await input.fill('ページ[');
  await expect(status).toHaveText('正規表現が不正です');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.search-layer > div')).toHaveCount(0);
  // Toggling with that text left in the box searches it as plain text and back again without errors
  await regex.click();
  await expect(status).toHaveText('見つかりません');
  await regex.click();
  await expect(status).toHaveText('正規表現が不正です');

  // Case-insensitive by default; Aa makes "b" stop matching "B"
  await input.fill('ページb');
  await expect(status).toHaveText('1 / 1 件');
  await matchCase.click();
  await expect(status).toHaveText('見つかりません');

  // The toggles survive closing and reopening the bar
  await input.press('Escape');
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('button', { name: '正規表現' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '大文字と小文字を区別' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.search-bar input').fill('ページ\\p{Lu}');
  await expect(page.locator('.search-status')).toHaveText('1 / 3 件');
});

test('印刷は全ページを画像にして注釈も含め、印刷後に片付ける（Ctrl+P でも同じ）', async ({ page }) => {
  // Replace the dialog: record what would be printed
  await page.addInitScript(() => {
    window.print = () => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>('#print-pages img')];
      const first = imgs[0];
      const canvas = new OffscreenCanvas(first.naturalWidth, first.naturalHeight);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(first, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 80) colored++;
      (window as unknown as { __printed: unknown[] }).__printed.push({
        count: imgs.length,
        sizes: imgs.map((i) => [i.naturalWidth, i.naturalHeight]),
        colored,
      });
      window.dispatchEvent(new Event('afterprint'));
    };
    (window as unknown as { __printed: unknown[] }).__printed = [];
  });
  await openPdf(page, 'sample-pages.pdf');
  const { box } = await pageGeometry(page);
  await selectTool(page, '四角');
  await page.mouse.move(box.x + 300, box.y + 600);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 700, { steps: 8 });
  await page.mouse.up();
  await selectTool(page, '選択');

  await page.locator('.toolbar .icon-btn[aria-label="印刷"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed.length)).toBe(1);
  type Printed = { count: number; sizes: number[][]; colored: number };
  const [printed] = await page.evaluate(() => (window as unknown as { __printed: Printed[] }).__printed);
  expect(printed.count).toBe(3);
  // A4 at 150 dpi
  expect(printed.sizes[0]).toEqual([1240, 1754]);
  // The square annotation is on the printed page
  expect(printed.colored).toBeGreaterThan(200);
  // Cleaned up after printing
  await expect(page.locator('#print-pages')).toHaveCount(0);

  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed.length)).toBe(2);
});
