import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { openPdf, pageGeometry, pdfStreams, saveVia } from './helpers';

/**
 * Local fonts (Local Font Access API) are used to render non-embedded fonts, for content-edit replacement, and as annotation typefaces.
 * The permission dialog cannot be automated, so queryLocalFonts is stubbed to serve Windows' msmincho.ttc (TTC)
 * as a real font. Checks end to end: TTC face selection, fsType check, subsetting and embedding.
 */
const TTC = 'C:\\Windows\\Fonts\\msmincho.ttc';

/** Stubs queryLocalFonts and turns on the "use local fonts" setting */
async function enableFakeLocalFonts(page: Page) {
  const ttc = readFileSync(TTC);
  await page.route('**/__local-fonts/msmincho.ttc', (route) => route.fulfill({ body: ttc, contentType: 'font/collection' }));
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
    const face = (postscriptName: string, fullName: string) => ({
      family: fullName,
      fullName,
      postscriptName,
      style: 'Regular',
      blob: () => fetch('/__local-fonts/msmincho.ttc').then((r) => r.blob()),
    });
    // msmincho.ttc holds two faces, MS-Mincho(0) and MS-PMincho(1). The PDF references MS-Mincho
    (window as { queryLocalFonts?: unknown }).queryLocalFonts = async () => [
      face('MS-PMincho', 'MS PMincho'),
      face('MS-Mincho', 'MS Mincho'),
    ];
  });
  // Enable in settings (this is where the permission dialog would appear)
  await page.goto('/');
  await page.locator('.toolbar button', { hasText: '設定' }).click();
  await page.locator('.settings-row', { hasText: 'PCのフォント' }).locator('input').check();
  await expect(page.locator('.settings-row', { hasText: 'PCのフォント' }).locator('input')).toBeChecked();
}

/** Extracts every FontFile2 embedded in the output PDF (inflated if Flate-compressed) */
function fontFiles(bytes: Buffer): Buffer[] {
  const out = pdfStreams(bytes)
    .filter((s) => s.dict.includes('/Length1'))
    .map((s) => s.data);
  expect(out.length).toBeGreaterThan(0);
  return out;
}

const utf16 = (s: string) => Buffer.from(s, 'utf16le').swap16();

test('PC の MS 明朝（TTC）で非埋め込み文書を表示し、同じ書体で本文を置換できる', async ({ page }) => {
  test.skip(!existsSync(TTC), 'MS 明朝が無い環境');
  await enableFakeLocalFonts(page);

  // Reopen (page reload -> font list restored from settings -> display fonts preloaded before opening)
  await openPdf(page, 'sample-msmincho.pdf');
  await page.waitForTimeout(500);
  const log: { face: string; source: string }[] = await page.evaluate(() => window.__pdf.runtime.fonts.log);
  expect(log.filter((r) => r.face === 'MS-Mincho').map((r) => r.source)).toEqual(['local']);

  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  const { box, scale } = await pageGeometry(page);

  // Double-click the sample line (MS-Mincho, not embedded) -> defaults to "same as original"
  await page.mouse.dblclick(box.x + 80 * scale, box.y + 106 * scale);
  await expect(page.locator('.popover input')).toHaveValue('この行は表示確認のための見本です。');
  await expect(page.locator('.popover select')).toHaveValue('local');
  await expect(page.locator('.popover option[value=local]')).toHaveText(/MS Mincho/);
  await page.fill('.popover input', 'この行は置換後の見本です。');
  await page.locator('.popover button', { hasText: '置換' }).click();
  await page.waitForTimeout(1000);

  await page.locator('.toolbar .save-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('.menu-list button')
      .filter({ has: page.locator('.menu-label', { hasText: '新ファイルで保存' }) })
      .click(),
  ]);
  const bytes = readFileSync((await download.path())!);

  // The embedded FontFile2 is a small subset of MS-Mincho (the first face in the TTC, not PMincho)
  const [ttf] = fontFiles(bytes);
  expect(ttf.includes(utf16('MS-Mincho'))).toBe(true);
  expect(ttf.includes(utf16('MS-PMincho'))).toBe(false);
  expect(ttf.length).toBeLessThan(50_000);

  // After reopening, the page content contains the replaced text
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
  expect(text).toContain('この行は置換後の見本です。');
});

test('テキスト注釈の書体に PC のフォントを選んで埋め込める', async ({ page }) => {
  test.skip(!existsSync(TTC), 'MS 明朝が無い環境');
  await enableFakeLocalFonts(page);
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  await page.locator('.toolbar button', { hasText: 'テキスト' }).first().click();
  await page.mouse.click(box.x + 120, box.y + 120);
  await page.waitForSelector('.popover textarea');
  // The "local fonts" group lists fonts suitable for Japanese text
  const options = page.locator('.popover select optgroup[label="PCのフォント"] option');
  await expect(options).toHaveText(['MS Mincho', 'MS PMincho']);
  await page.locator('.popover select').first().selectOption('local:MS-Mincho');
  await page.fill('.popover textarea', '明朝の注釈');
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);

  const bytes = await saveVia(page, '注釈付きで保存');
  // Incremental save, so an MS-Mincho subset for the annotation is appended after the original BIZ UD font
  const ttf = fontFiles(bytes).find((f) => f.includes(utf16('MS-Mincho')));
  expect(ttf).toBeDefined();
  expect(ttf!.length).toBeLessThan(50_000);
});
