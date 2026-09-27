import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes } from './helpers';

const STAMP = 13;

/** beforeunload の確認を受け入れつつ再読み込み */
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
  // 自動保存（変更後 1 秒）を待つ
  await page.waitForTimeout(1800);

  // 既定では起動時に前回の作業が自動で開き、注釈ごと戻る
  await reloadAccepting(page);
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  await expect(page.locator('.toolbar .doc-name')).toHaveText('sample-ja-form.pdf');
  expect(await annotationTypes(page)).toEqual([STAMP]);

  // 同じファイルを開き直しても一覧は増えない
  await page.locator('input[type=file]').first().setInputFiles('samples/sample-ja-form.pdf');
  await page.waitForTimeout(800);
  await recentMenu(page).click();
  await expect(page.locator('.recent-row')).toHaveCount(1);
  await recentMenu(page).click();

  // 別のファイルを開いたあと、一覧から元のファイルを開き直すと、それが「最後に使った」扱いになる
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

  // 自動再開をオフにすると、空状態に「前回の作業を再開」が出てボタンで開く
  await page.locator('.toolbar button', { hasText: '設定' }).click();
  await page.locator('.settings-row', { hasText: '自動的に前回の作業を再開' }).locator('input').uncheck();
  await reloadAccepting(page);
  await expect(page.locator('.resume-btn')).toContainText('sample-ja-form.pdf');
  await page.locator('.resume-btn').click();
  await page.waitForSelector('.page img');
  await expect(page.locator('.toolbar .doc-name')).toHaveText('sample-ja-form.pdf');
});
