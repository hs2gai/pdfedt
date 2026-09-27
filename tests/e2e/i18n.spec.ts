import { test, expect } from '@playwright/test';
import { openPdf } from './helpers';

/** UI の言語切り替え（既定は日本語。設定は localStorage に残る） */
test('設定で英語に切り替えると表示が変わり、再読み込み後も保たれる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  await expect(page.locator('.toolbar .icon-btn[aria-label="スタンプ"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  await page.locator('.toolbar .icon-btn[aria-label="設定"]').click();
  await page.locator('.settings-select select').selectOption('en');
  await expect(page.locator('.toolbar .icon-btn[aria-label="Stamp"]')).toHaveCount(1);
  await expect(page.locator('.toolbar .icon-btn[aria-label="Settings"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // スタンプパネルの文言も英語
  await page.locator('.toolbar .icon-btn[aria-label="Stamp"]').click();
  await expect(page.locator('.stamp-panel')).toContainText('Tap / click the page');

  await page.reload();
  await page.waitForSelector('.toolbar');
  await expect(page.locator('.toolbar .icon-btn[aria-label="Open"]')).toHaveCount(1);

  // 日本語に戻す
  await page.locator('.toolbar .icon-btn[aria-label="Settings"]').click();
  await page.locator('.settings-select select').selectOption('ja');
  await expect(page.locator('.toolbar .icon-btn[aria-label="開く"]')).toHaveCount(1);
});
