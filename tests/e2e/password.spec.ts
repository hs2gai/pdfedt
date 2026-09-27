import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pageGeometry, addText, annotationTypes, saveVia, sample } from './helpers';

test('パスワード付き PDF を開いて注釈し、増分保存できる', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
  });
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').first().setInputFiles(sample('sample-encrypted.pdf'));

  const prompt = page.locator('.password-prompt');
  await expect(prompt).toBeVisible();
  await prompt.locator('input').fill('wrong');
  await prompt.locator('button').click();
  await expect(prompt.locator('.error')).toBeVisible();

  await prompt.locator('input').fill('1234');
  await prompt.locator('button').click();
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  await expect(page.locator('.badges')).toContainText('暗号化');

  const { box } = await pageGeometry(page);
  await addText(page, box.x + 320, box.y + 395, '暗号化テスト');
  expect(await annotationTypes(page)).toEqual([13]);

  const original = readFileSync(sample('sample-encrypted.pdf'));
  const saved = await saveVia(page, '注釈付きで保存');
  expect(saved.subarray(0, original.length).equals(original)).toBe(true);
  // 保存後も同じパスワードで開けて注釈が残る
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: saved });
  await expect(page.locator('.password-prompt')).toBeVisible();
  await page.locator('.password-prompt input').fill('1234');
  await page.locator('.password-prompt button').click();
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  expect(await annotationTypes(page)).toEqual([13]);
});
