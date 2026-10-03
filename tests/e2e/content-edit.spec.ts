import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes, selectTool } from './helpers';

/** Phase 3: content edit mode (gate -> select, move, replace text, marquee delete -> save under a new name) */
test('本文編集モードで移動・置換・削除して確定保存できる', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-ja-form.pdf');

  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await expect(page.locator('.modal')).toContainText('元の内容が書き換わり');
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  // The banner shifts the page, so measure after entering the mode
  const { box, scale } = await pageGeometry(page);

  // Annotation tools still work in the mode (place a text annotation). Switching back to the Content tool returns to selecting page content
  await addText(page, box.x + 400, box.y + 900, 'モード中の注釈');
  expect(await annotationTypes(page)).toHaveLength(1);
  await selectTool(page, '本文');
  await page.waitForTimeout(300);
  // Clicking an annotation with the Content tool selects it and switches to the Select tool
  await page.mouse.click(box.x + 410, box.y + 910);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pdf.annotations.getSelectedAnnotations().length)).toBe(1);
  await expect(page.locator('.toolbar .icon-btn[aria-label="選択"]')).toHaveClass(/active/);
  // Conversely, clicking content with no annotation (the title heading) with the Select tool switches back to the Content tool and selects it
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + 300 * scale, box.y + 54 * scale);
  await expect(page.locator('.toolbar .icon-btn[aria-label="本文"]')).toHaveClass(/active/);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.waitForTimeout(300);

  // Select the addressee line ("To the Mayor of XX") and move it to the lower right
  await page.mouse.click(box.x + 70 * scale, box.y + 116 * scale);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.mouse.move(box.x + 70 * scale, box.y + 116 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 110 * scale, box.y + 136 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Replace the sentence "I hereby apply as stated above."
  await page.mouse.dblclick(box.x + 80 * scale, box.y + 316 * scale);
  await expect(page.locator('.popover input')).toHaveValue('上記のとおり申請します。');
  await page.fill('.popover input', '以上のとおり申請いたします。');
  await page.locator('.popover button', { hasText: '置換' }).click();
  await page.waitForTimeout(800);

  // Marquee-select the Reiwa date line and delete it
  await page.mouse.move(box.x + 440 * scale, box.y + 70 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 560 * scale, box.y + 105 * scale, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);

  // Incremental save is unavailable, and the full save uses a new file name
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('.menu-list button')
      .filter({ has: page.locator('.menu-label', { hasText: '新ファイルで保存' }) })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe('sample-ja-form_n.pdf');

  // Reopen the exported PDF: the replaced text is in the content and the deleted text is gone
  const bytes = (await import('node:fs')).readFileSync((await download.path())!);
  await page.locator('.toolbar button', { hasText: '本文編集を終了' }).click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'edited.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  const text: string = await page.evaluate(async () => {
    const rt = window.__pdf.runtime;
    const doc = window.__pdf.docs.getActiveDocument();
    const t = await rt.engine.getPageTextRects(doc, doc.pages[0]).toPromise();
    return t.map((r: { content: string }) => r.content).join('\n');
  });
  expect(text).toContain('以上のとおり申請いたします。');
  expect(text).not.toContain('令和');
});

/**
 * Non-text objects marked as /Artifact (e.g. leftovers of a Word watermark) are background objects:
 * hidden and unselectable until "Include watermarks and backgrounds" is checked
 */
test('本文編集モードで透かし（背景）は既定で選べず、切り替えると選べる', async ({ page }) => {
  await openPdf(page, 'sample-watermark.pdf');
  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  const { box, scale } = await pageGeometry(page);
  // Inside the bounds of the diagonal watermark line (x 90–510, y 132–652 from the top), away from the body text
  const at = { x: box.x + 450 * scale, y: box.y + 550 * scale };

  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.ce-object.selected')).toHaveCount(0);
  await expect(page.locator('.ce-background')).toHaveCount(0);
  // The body text is still selectable
  await page.mouse.click(box.x + 80 * scale, box.y + 96 * scale);
  await expect(page.locator('.ce-object.ce-text.selected')).toHaveCount(1);

  await page.locator('.content-edit-banner-toggle input').check();
  await expect(page.locator('.ce-background')).toHaveCount(1);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.ce-object.ce-background.selected')).toHaveCount(1);
});
