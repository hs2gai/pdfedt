import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, sample } from './helpers';

/** Returns the text (leading string) of each page in order */
async function pageTexts(page: Page): Promise<string[]> {
  await page.waitForTimeout(600);
  return page.evaluate(async () => {
    const rt = window.__pdf.runtime;
    const doc = window.__pdf.docs.getActiveDocument();
    const out: string[] = [];
    for (const p of doc.pages) {
      const t = await rt.engine.getPageTextRects(doc, p).toPromise();
      // Strip control characters that sometimes appear in the extracted text
      out.push(
        t
          .map((r: { content: string }) => r.content)
          .join('')
          .replace(/[\x00-\x1f]/g, ''),
      );
    }
    return out;
  });
}

test('サムネイルからページを削除・並べ替え・PDF の追加ができ、保存は確定保存に限られる', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await expect(page.locator('.thumb')).toHaveCount(3);
  expect(await pageTexts(page)).toEqual(['ページA', 'ページB', 'ページC']);

  // Select page 2 and press Delete -> confirm -> deleted
  await page.locator('.thumb').nth(1).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.modal')).toContainText('ページ2を削除しますか');
  await page.locator('.modal button', { hasText: '削除する' }).click();
  await page.waitForSelector('.page img');
  await expect(page.locator('.thumb')).toHaveCount(2);
  expect(await pageTexts(page)).toEqual(['ページA', 'ページC']);
  await expect(page.locator('.status-bar')).toContainText('ページ2を削除しました');

  // Drag page 2 (C) onto the top half of page 1 -> moves to the front
  const first = page.locator('.thumb').nth(0);
  const box = (await first.boundingBox())!;
  await page.locator('.thumb').nth(1).hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2, box.y + 8, { steps: 2 });
  await page.mouse.up();
  await page.waitForSelector('.page img');
  expect(await pageTexts(page)).toEqual(['ページC', 'ページA']);

  // Dropping a PDF file after the last thumbnail (empty area of the list) appends its pages
  const extra = readFileSync(sample('sample-msmincho.pdf')).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'extra.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const pane = document.querySelector('.thumbs')!;
    const r = pane.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.bottom - 5 };
    pane.dispatchEvent(new DragEvent('dragover', init));
    pane.dispatchEvent(new DragEvent('drop', init));
  }, extra);
  await page.waitForSelector('.page img');
  await expect(page.locator('.thumb')).toHaveCount(3);
  const texts = await pageTexts(page);
  expect(texts.slice(0, 2)).toEqual(['ページC', 'ページA']);
  expect(texts[2]).toContain('見本の文書');

  // A document whose page structure changed cannot be saved incrementally
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
});
