import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry } from './helpers';

/** Undo / Redo in content edit mode (move, delete and replace can be undone with Ctrl+Z or the toolbar) */
test('本文編集モードで移動・削除・置換を取り消せる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  const { box, scale } = await pageGeometry(page);

  const objects = () =>
    page.evaluate(() => {
      const d = window.__pdf.docs.getActiveDocument();
      const pdfium = window.__pdf.runtime.pdfium;
      const cache = window.__pdf.runtime.native.cache;
      return cache.getContext(d.id).borrowPage(0, (ctx: { pagePtr: number }) => {
        const n = pdfium.FPDFPage_CountObjects(ctx.pagePtr) as number;
        const buf = pdfium.pdfium.wasmExports.malloc(16);
        const out: number[][] = [];
        for (let i = 0; i < n; i++) {
          const obj = pdfium.FPDFPage_GetObject(ctx.pagePtr, i);
          pdfium.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12);
          out.push([0, 4, 8, 12].map((o) => Math.round(pdfium.pdfium.getValue(buf + o, 'float'))));
        }
        pdfium.pdfium.wasmExports.free(buf);
        return out;
      });
    });
  const before = await objects();
  const undoBtn = page.locator('.toolbar button', { hasText: '元に戻す' });
  const redoBtn = page.locator('.toolbar button', { hasText: 'やり直す' });
  await expect(undoBtn).toBeDisabled();

  // Move, then Ctrl+Z restores the original position
  await page.mouse.click(box.x + 70 * scale, box.y + 116 * scale);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.mouse.move(box.x + 70 * scale, box.y + 116 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 110 * scale, box.y + 136 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await objects()).not.toEqual(before);
  await expect(undoBtn).toBeEnabled();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  expect(await objects()).toEqual(before);
  await expect(redoBtn).toBeEnabled();

  // Delete, undo from the toolbar, then redo
  await page.mouse.move(box.x + 440 * scale, box.y + 70 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 560 * scale, box.y + 105 * scale, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  expect((await objects()).length).toBe(before.length - 1);
  await undoBtn.click();
  await page.waitForTimeout(400);
  expect(await objects()).toEqual(before);
  await redoBtn.click();
  await page.waitForTimeout(400);
  expect((await objects()).length).toBe(before.length - 1);
  await undoBtn.click();
  await page.waitForTimeout(400);

  // Replace, then undo restores the original text
  await page.mouse.dblclick(box.x + 80 * scale, box.y + 316 * scale);
  await expect(page.locator('.popover input')).toHaveValue('上記のとおり申請します。');
  await page.fill('.popover input', '以上のとおり申請いたします。');
  await page.locator('.popover button', { hasText: '置換' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  expect(await objects()).toEqual(before);
  await page.mouse.dblclick(box.x + 80 * scale, box.y + 316 * scale);
  await expect(page.locator('.popover input')).toHaveValue('上記のとおり申請します。');
});
