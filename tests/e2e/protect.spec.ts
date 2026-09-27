import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, pageGeometry, addText, annotationTypes, saveVia, sample } from './helpers';

const STAMP = 13;

test.beforeEach(async ({ page }) => {
  // File System Access API を無効化してダウンロード経路を使わせる
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
  });
});

/** バイト列を開き直し、パスワード入力を経て表示されるまで待つ */
async function reopenWithPassword(page: Page, bytes: Buffer, password: string) {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('.password-prompt')).toBeVisible();
  await page.locator('.password-prompt input').fill(password);
  await page.locator('.password-prompt button').click();
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
}

const isEncrypted = (bytes: Buffer) => /\/Encrypt\b/.test(bytes.toString('latin1'));

test('パスワードを付けて保存すると、開くときにパスワードが必要になる', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await addText(page, box.x + 320, box.y + 395, '暗号化して保存');

  await page.locator('.toolbar .save-btn').click();
  await page.locator('.menu-list button', { hasText: 'パスワードを付けて保存' }).click();
  const dialog = page.locator('.protect-dialog');
  const submit = dialog.locator('button[type=submit]');
  const [pw, confirm] = [dialog.locator('input[type=password]').nth(0), dialog.locator('input[type=password]').nth(1)];

  // 不一致・免責への同意なしでは保存できない
  await pw.fill('Secret-2026');
  await confirm.fill('Secret-2025');
  await expect(dialog.locator('.error')).toBeVisible();
  await expect(submit).toBeDisabled();
  await confirm.fill('Secret-2026');
  await expect(submit).toBeDisabled();
  await expect(dialog).toContainText('無保証');
  await dialog.locator('input[type=checkbox]').check();
  await expect(submit).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent('download'), submit.click()]);
  const saved = readFileSync((await download.path())!);
  expect(isEncrypted(saved)).toBe(true);

  // 作業中の文書には暗号化が残らない（通常の保存は平文のまま）
  const plain = await saveVia(page, '新ファイルで保存');
  expect(isEncrypted(plain)).toBe(false);

  await reopenWithPassword(page, saved, 'Secret-2026');
  expect(await annotationTypes(page)).toEqual([STAMP]);

  // ページ操作後の開き直しでもパスワードを聞き直さず、保存結果にもパスワードが残る
  const pages = await page.locator('.thumb').count();
  const extra = readFileSync(sample('sample-msmincho.pdf')).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'extra.pdf', { type: 'application/pdf' }));
    const pane = document.querySelector('.thumbs')!;
    const r = pane.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.bottom - 5 };
    pane.dispatchEvent(new DragEvent('dragover', init));
    pane.dispatchEvent(new DragEvent('drop', init));
  }, extra);
  await expect(page.locator('.thumb')).toHaveCount(pages + 1);
  await expect(page.locator('.password-prompt')).toHaveCount(0);
  const restructured = await saveVia(page, '新ファイルで保存');
  expect(isEncrypted(restructured)).toBe(true);
  await reopenWithPassword(page, restructured, 'Secret-2026');
  await expect(page.locator('.thumb')).toHaveCount(pages + 1);
});

test('パスワード付きで開いた文書は、どの保存でも同じパスワードが残る', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await reopenWithPassword(page, readFileSync(sample('sample-encrypted.pdf')), '1234');
  const { box } = await pageGeometry(page);
  await addText(page, box.x + 320, box.y + 395, '確定');

  const full = await saveVia(page, '新ファイルで保存');
  expect(isEncrypted(full)).toBe(true);
  const flat = await saveVia(page, '確定して書き出し');
  expect(isEncrypted(flat)).toBe(true);
  expect(flat.toString('latin1')).not.toMatch(/\/Subtype\s*\/Stamp/);

  await reopenWithPassword(page, flat, '1234');
  expect(await annotationTypes(page)).toEqual([]);
});
