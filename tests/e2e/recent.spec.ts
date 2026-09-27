import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes } from './helpers';

const STAMP = 13;

/** Reloads the page, accepting the beforeunload prompt */
async function reloadAccepting(page: import('@playwright/test').Page) {
  const dialog = page.waitForEvent('dialog');
  await Promise.all([page.reload(), dialog.then((d) => d.accept())]);
  expect((await dialog).type()).toBe('beforeunload');
}

const recentMenu = (page: import('@playwright/test').Page) => page.locator('button[aria-label="最近使ったファイル"]');

test('注釈した状態がリロード後に「最近使ったファイル」から復元できる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await addText(page, box.x + 100, box.y + 100, '復元テスト');
  expect(await annotationTypes(page)).toEqual([STAMP]);
  // Wait for autosave (1 second after a change)
  await page.waitForTimeout(1800);

  // By default the previous work reopens automatically on startup, annotations included
  await reloadAccepting(page);
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  await expect(page.locator('.toolbar .doc-name')).toHaveText('sample-ja-form.pdf');
  expect(await annotationTypes(page)).toEqual([STAMP]);

  // Reopening the same file does not add a new entry to the list
  await page.locator('input[type=file]').first().setInputFiles('samples/sample-ja-form.pdf');
  await page.waitForTimeout(800);
  await recentMenu(page).click();
  await expect(page.locator('.recent-row')).toHaveCount(1);
  await recentMenu(page).click();

  // After opening another file, reopening the original from the list makes it the most recently used
  await page.locator('input[type=file]').first().setInputFiles('samples/sample-noembed.pdf');
  await page.waitForTimeout(800);
  await recentMenu(page).click();
  await expect(page.locator('.recent-row').first()).toContainText('sample-noembed.pdf');
  await page.locator('.recent-row', { hasText: 'sample-ja-form.pdf' }).locator('button').first().click();
  await page.waitForSelector('.page img');
  await page.waitForTimeout(800);
  await recentMenu(page).click();
  await expect(page.locator('.recent-row').first()).toContainText('sample-ja-form.pdf');
  await recentMenu(page).click();

  // With auto-resume off, the empty state shows a "resume previous work" button that opens it
  await page.locator('.toolbar button', { hasText: '設定' }).click();
  await page.locator('.settings-row', { hasText: '自動的に前回の作業を再開' }).locator('input').uncheck();
  await reloadAccepting(page);
  await expect(page.locator('.resume-btn')).toContainText('sample-ja-form.pdf');
  await page.locator('.resume-btn').click();
  await page.waitForSelector('.page img');
  await expect(page.locator('.toolbar .doc-name')).toHaveText('sample-ja-form.pdf');
});
