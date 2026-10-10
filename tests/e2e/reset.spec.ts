import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes, waitUntilOpened } from './helpers';

const resetItem = (page: Page) =>
  page.locator('.menu-list button', { has: page.locator('.menu-label', { hasText: '最初に開いた状態に戻す' }) });

async function askReset(page: Page) {
  await page.locator('.toolbar .save-btn').click();
  await resetItem(page).click();
  await expect(page.locator('.modal')).toContainText('最初に開いた状態に戻しますか');
}

test('保存メニューの「最初に開いた状態に戻す」で、注釈もページ操作も取り消して開いたときのファイルに戻り、リロード後もそのまま', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await expect(page.locator('.thumb')).toHaveCount(3);

  // Delete page 2 (the document is reopened from rebuilt bytes), then annotate
  await page.locator('.thumb').nth(1).click();
  await page.keyboard.press('Delete');
  await page.locator('.modal button', { hasText: '削除する' }).click();
  await expect(page.locator('.thumb')).toHaveCount(2);
  const { box } = await pageGeometry(page);
  await addText(page, box.x + 100, box.y + 100, '取り消す注釈');
  expect(await annotationTypes(page)).toHaveLength(1);

  // Cancel keeps everything
  await askReset(page);
  await page.locator('.modal button', { hasText: 'キャンセル' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await annotationTypes(page)).toHaveLength(1);
  await expect(page.locator('.thumb')).toHaveCount(2);

  await askReset(page);
  await page.locator('.modal button', { hasText: '元に戻す' }).click();
  await expect(page.locator('.status-bar')).toContainText('最初に開いた状態に戻しました');
  await expect(page.locator('.thumb')).toHaveCount(3);
  await waitUntilOpened(page);
  expect(await annotationTypes(page)).toEqual([]);
  // Page operations made the document "content edited"; reverting allows the incremental save again
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeEnabled();
  await page.locator('.toolbar .save-btn').click();

  // The working copy in "recent files" was replaced too: a reload resumes the original
  await page.waitForTimeout(1500);
  const dialog = page.waitForEvent('dialog');
  await Promise.all([page.reload(), dialog.then((d) => d.accept())]);
  await waitUntilOpened(page);
  await page.waitForTimeout(500);
  await expect(page.locator('.thumb')).toHaveCount(3);
  expect(await annotationTypes(page)).toEqual([]);

  // Still revertable after the reload (the original is kept with the entry)
  await addText(page, box.x + 120, box.y + 140, 'もう一度');
  expect(await annotationTypes(page)).toHaveLength(1);
  await askReset(page);
  await page.locator('.modal button', { hasText: '元に戻す' }).click();
  await expect(page.locator('.status-bar')).toContainText('最初に開いた状態に戻しました');
  await waitUntilOpened(page);
  await page.waitForTimeout(300);
  expect(await annotationTypes(page)).toEqual([]);
});
