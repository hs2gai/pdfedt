import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, sample, saveVia, selectTool, waitUntilOpened } from './helpers';

/**
 * Returns the text of each page in order, read straight from PDFium's text page
 * (the engine's getPageTextRects sometimes appends bytes past the end of the text, which vary after reopening)
 */
async function pageTexts(page: Page): Promise<string[]> {
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const rt = window.__pdf.runtime;
    const m = rt.pdfium;
    const ctx = rt.native.cache.getContext(window.__pdf.docs.getActiveDocument().id);
    const out: string[] = [];
    for (let i = 0; i < m.FPDF_GetPageCount(ctx.docPtr); i++) {
      ctx.borrowPage(i, (pc: { getTextPage(): number }) => {
        const tp = pc.getTextPage();
        let text = '';
        for (let k = 0; k < m.FPDFText_CountChars(tp); k++) text += String.fromCodePoint(m.FPDFText_GetUnicode(tp, k));
        out.push(text.replace(/[\x00-\x1f]/g, ''));
      });
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
  await waitUntilOpened(page);
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
  await waitUntilOpened(page);
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
  await waitUntilOpened(page);
  await expect(page.locator('.thumb')).toHaveCount(3);
  const texts = await pageTexts(page);
  expect(texts.slice(0, 2)).toEqual(['ページC', 'ページA']);
  expect(texts[2]).toContain('見本の文書');

  // A document whose page structure changed cannot be saved incrementally
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
});

test('ツールバーで表示中のページを回転でき、保存した PDF に /Rotate が残る', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-pages.pdf');
  const rotations = () =>
    page.evaluate(() => window.__pdf.docs.getActiveDocument().pages.map((p: { rotation: number }) => p.rotation));
  expect(await rotations()).toEqual([0, 0, 0]);

  // Go to page 2 and rotate it right
  await page.locator('.thumb').nth(1).click();
  await page.waitForTimeout(300);
  await page.locator('.toolbar .icon-btn[aria-label="右に回転"]').click();
  await expect(page.locator('.status-bar')).toContainText('ページ2を右に回転しました');
  await waitUntilOpened(page);
  await expect.poll(rotations).toEqual([0, 1, 0]);
  const box = (await page.locator('.page').nth(1).boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height);
  expect(await pageTexts(page)).toEqual(['ページA', 'ページB', 'ページC']);

  // Rotating left twice from 90° gives 270°
  await page.locator('.toolbar .icon-btn[aria-label="左に回転"]').click();
  await expect.poll(rotations).toEqual([0, 0, 0]);
  await page.locator('.toolbar .icon-btn[aria-label="左に回転"]').click();
  await expect.poll(rotations).toEqual([0, 3, 0]);

  // Rotation counts as a page change: no incremental save, and the saved file keeps /Rotate
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
  await page.keyboard.press('Escape');
  const saved = await saveVia(page, '新ファイルで保存');
  expect(saved.toString('latin1')).toMatch(/\/Rotate\s*270/);
});

test('本文編集モード中はページを回転できない', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await expect(page.locator('.toolbar .icon-btn[aria-label="右に回転"]')).toBeEnabled();
  await page.locator('.toolbar .icon-btn[aria-label="本文編集"]').click();
  await page.locator('.modal button.primary').click();
  await expect(page.locator('.toolbar .icon-btn[aria-label="右に回転"]')).toBeDisabled();
});

test('回転したページでもドラッグした位置に注釈が付く', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await page.locator('.toolbar .icon-btn[aria-label="右に回転"]').click();
  await expect(page.locator('.status-bar')).toContainText('ページ1を右に回転しました');
  await expect(page.locator('.toolbar .icon-btn[aria-label="右に回転"]')).toBeEnabled();

  // Page 1 is now shown landscape. Draw a square at (50,100)–(150,160) pt in the rotated view
  const box = (await page.locator('.page').first().boundingBox())!;
  const { width: w, height: h } = await page.evaluate(() => window.__pdf.docs.getActiveDocument().pages[0].size);
  expect(box.width).toBeGreaterThan(box.height);
  const scale = box.width / h;
  await selectTool(page, '四角');
  await page.mouse.move(box.x + 50 * scale, box.y + 100 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 150 * scale, box.y + 160 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // 90° clockwise: view (vx, vy) ↔ page (x, y) = (vy, h - vx), so the square covers x 100–160, y (h-150)–(h-50)
  const rect = await page.evaluate(() => window.__pdf.annotations.getAnnotations()[0].object.rect);
  expect(w).toBeLessThan(h);
  expect(rect.origin.x).toBeCloseTo(100, -1);
  expect(rect.origin.x + rect.size.width).toBeCloseTo(160, -1);
  expect(rect.origin.y).toBeCloseTo(h - 150, -1);
  expect(rect.origin.y + rect.size.height).toBeCloseTo(h - 50, -1);
});
