import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { openPdf, pageGeometry, saveVia } from './helpers';

/**
 * PC のフォント（Local Font Access API）を非埋め込みフォントの表示・本文編集の置換・注釈の書体に使う。
 * 許可ダイアログは自動化できないので queryLocalFonts を差し替え、Windows の msmincho.ttc（TTC）を
 * 本物のフォントとして流す。TTC の書体特定・fsType 判定・サブセット化・埋め込みまでを通しで確認する。
 */
const TTC = 'C:\\Windows\\Fonts\\msmincho.ttc';

/** queryLocalFonts を差し替え、設定「PC のフォントを使う」をオンにする */
async function enableFakeLocalFonts(page: Page) {
  const ttc = readFileSync(TTC);
  await page.route('**/__local-fonts/msmincho.ttc', (route) => route.fulfill({ body: ttc, contentType: 'font/collection' }));
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
    const face = (postscriptName: string, fullName: string) => ({
      family: fullName,
      fullName,
      postscriptName,
      style: 'Regular',
      blob: () => fetch('/__local-fonts/msmincho.ttc').then((r) => r.blob()),
    });
    // msmincho.ttc は MS-Mincho(0) と MS-PMincho(1) の 2 書体。PDF は MS-Mincho を参照している
    (window as { queryLocalFonts?: unknown }).queryLocalFonts = async () => [
      face('MS-PMincho', 'MS PMincho'),
      face('MS-Mincho', 'MS Mincho'),
    ];
  });
  // 設定で有効化（ここで許可ダイアログが出る想定）
  await page.goto('/');
  await page.locator('.toolbar button', { hasText: '設定' }).click();
  await page.locator('.settings-row', { hasText: 'PCのフォント' }).locator('input').check();
  await expect(page.locator('.settings-row', { hasText: 'PCのフォント' }).locator('input')).toBeChecked();
}

/** 出力 PDF に埋め込まれた FontFile2 をすべて取り出す（Flate 圧縮なら展開） */
function fontFiles(bytes: Buffer): Buffer[] {
  const pdf = bytes.toString('latin1');
  const out: Buffer[] = [];
  for (const m of pdf.matchAll(/<<([^>]*?\/Length1[^>]*?)>>\s*stream\r?\n/g)) {
    const length = Number(/\/Length\s+(\d+)/.exec(m[1])![1]);
    const stream = bytes.subarray(m.index! + m[0].length, m.index! + m[0].length + length);
    out.push(m[1].includes('/FlateDecode') ? inflateSync(stream) : Buffer.from(stream));
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

const utf16 = (s: string) => Buffer.from(s, 'utf16le').swap16();

test('PC の MS 明朝（TTC）で非埋め込み文書を表示し、同じ書体で本文を置換できる', async ({ page }) => {
  test.skip(!existsSync(TTC), 'MS 明朝が無い環境');
  await enableFakeLocalFonts(page);

  // 開き直す（ページ再読み込み → 設定から一覧を復元 → 開く前に表示用フォントを先読み）
  await openPdf(page, 'sample-msmincho.pdf');
  await page.waitForTimeout(500);
  const log: { face: string; source: string }[] = await page.evaluate(() => window.__pdf.runtime.fonts.log);
  expect(log.filter((r) => r.face === 'MS-Mincho').map((r) => r.source)).toEqual(['local']);

  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  const { box, scale } = await pageGeometry(page);

  // 「この行は表示確認のための見本です。」（MS-Mincho 非埋め込み）をダブルクリック → 既定が「元と同じ」
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

  // 埋め込まれた FontFile2 は MS-Mincho（TTC の 1 書体目。PMincho ではない）の小さなサブセット
  const [ttf] = fontFiles(bytes);
  expect(ttf.includes(utf16('MS-Mincho'))).toBe(true);
  expect(ttf.includes(utf16('MS-PMincho'))).toBe(false);
  expect(ttf.length).toBeLessThan(50_000);

  // 開き直して本文に置換後の文字がある
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
  // 「PC のフォント」のグループに和文向けのフォントが並ぶ
  const options = page.locator('.popover select optgroup[label="PCのフォント"] option');
  await expect(options).toHaveText(['MS Mincho', 'MS PMincho']);
  await page.locator('.popover select').first().selectOption('local:MS-Mincho');
  await page.fill('.popover textarea', '明朝の注釈');
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);

  const bytes = await saveVia(page, '注釈付きで保存');
  // 追記保存なので元文書の BIZ UD の後ろに、注釈用の MS-Mincho サブセットが加わる
  const ttf = fontFiles(bytes).find((f) => f.includes(utf16('MS-Mincho')));
  expect(ttf).toBeDefined();
  expect(ttf!.length).toBeLessThan(50_000);
});
