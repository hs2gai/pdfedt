import { test, expect } from '@playwright/test';
import { openPdf, saveVia } from './helpers';

type FieldSummary = { name: string; value: string };
const fieldValues = (page: import('@playwright/test').Page): Promise<FieldSummary[]> =>
  page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .filter((a: { object: { type: number } }) => a.object.type === 20)
      .map((a: { object: { field: { name: string; value: string } } }) => ({
        name: a.object.field.name,
        value: a.object.field.value,
      })),
  );

/** Fill an AcroForm field; the value survives a save with annotations (incremental) */
test('フォームに入力して保存できる', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-form.pdf');
  await expect(page.locator('.badge', { hasText: 'フォーム' })).toBeVisible();

  const inputs = page.locator('.page input[type=text], .page textarea');
  await expect(inputs.first()).toBeAttached();
  const first = inputs.first();
  const name = await first.getAttribute('name');
  await first.click();
  await page.keyboard.type('山田　太郎');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  expect((await fieldValues(page)).find((f) => f.name === name)?.value).toBe('山田　太郎');

  // The value remains after saving and reopening
  const saved = await saveVia(page, '注釈付きで保存');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'filled.pdf', mimeType: 'application/pdf', buffer: saved });
  await page.waitForSelector('.page img');
  await page.waitForTimeout(800);
  expect((await fieldValues(page)).find((f) => f.name === name)?.value).toBe('山田　太郎');
});
