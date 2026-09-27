import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, pageGeometry, saveVia } from './helpers';

const STAMP = 13;

async function placeStamp(
  page: import('@playwright/test').Page,
  selector: string,
  x: number,
  y: number,
  fill: Record<string, string> = {},
) {
  await page.locator('.toolbar button', { hasText: 'スタンプ' }).click();
  await page.waitForSelector('.stamp-panel');
  await page.locator(selector).first().click();
  for (const [label, value] of Object.entries(fill)) {
    await page.locator('.stamp-fields label', { hasText: label }).locator('input').fill(value);
  }
  await page.mouse.click(x, y);
  await page.waitForTimeout(900);
}

test('プリセットのスタンプを押して保存できる', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  // 作例: 四角（上段・日付・氏名）/ データ印（部署・短い日付・氏名）/ 丸・縦書き（氏名）
  await placeStamp(page, '.stamp-preset[title^="四角"]', box.x + 900, box.y + 300, { 下段: '山田' });
  await placeStamp(page, '.stamp-preset[title^="データ印"]', box.x + 900, box.y + 500, { 上段: '総務部', 下段: '山田' });
  await placeStamp(page, '.stamp-preset[title^="丸（縦書き）"]', box.x + 1100, box.y + 500, { 文字: '山田太郎' });

  type Summary = {
    type: number;
    flags: string[];
    pdfa?: { template: string; values: Record<string, string> };
  };
  const annots: Summary[] = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { type: number; flags: string[]; custom?: { pdfa?: Summary['pdfa'] } } }) => ({
        type: a.object.type,
        flags: a.object.flags,
        pdfa: a.object.custom?.pdfa,
      })),
  );
  expect(annots.map((a) => a.type)).toEqual([STAMP, STAMP, STAMP]);
  expect(annots.map((a) => a.pdfa?.template)).toEqual(['builtin-box', 'builtin-date-seal', 'builtin-round-vertical']);
  expect(annots[0].pdfa?.values['上段']).toBe('承認');
  expect(annots[0].pdfa?.values['日付']).toMatch(/^令和\d+年\d+月\d+日$/);
  expect(annots[1].pdfa?.values['短い日付']).toMatch(/^R\d+\.\d+\.\d+$/);
  expect([annots[1].pdfa?.values['上段'], annots[1].pdfa?.values['下段']]).toEqual(['総務部', '山田']);
  expect(annots[2].pdfa?.values['文字']).toBe('山田太郎');
  for (const a of annots) expect(a.flags).toContain('print');

  // ツールは 1 回押すと選択に戻る（連打しない）
  await expect(page.locator('.stamp-panel')).toHaveCount(0);

  // カスタム書式（Excel 風）
  await page.locator('.toolbar button', { hasText: 'スタンプ' }).click();
  await page.locator('.stamp-preset[title^="四角"]').click();
  await page.locator('.stamp-fields label', { hasText: '日付' }).locator('select').selectOption('custom');
  await page.locator('.stamp-fields input.date-custom').fill('yyyy-mm-dd aaa');
  await expect(page.locator('.stamp-fields label', { hasText: '書式' }).locator('.stamp-hint')).toHaveText(
    /^→ \d{4}-\d{2}-\d{2} [日月火水木金土]$/,
  );

  // 四角: 日付なし・下段が空なら 2 段目を詰めて低くなる
  await page.locator('.stamp-fields label', { hasText: '日付' }).locator('select').selectOption('none');
  await page.locator('.stamp-fields label', { hasText: '下段' }).locator('input').fill('');
  await page.mouse.click(box.x + 600, box.y + 300);
  await page.waitForTimeout(900);
  const heights: number[] = await page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().map((a: { object: { rect: { size: { height: number } } } }) => a.object.rect.size.height),
  );
  expect(heights[3]).toBeLessThan(heights[0] - 10); // 38pt → 26pt

  // 縦横比を保ったリサイズ後も外観（埋め込みフォント）が保たれる
  await page.evaluate(() => {
    const a = window.__pdf.annotations;
    const o = a.getAnnotations()[0].object;
    a.updateAnnotation(o.pageIndex, o.id, {
      rect: { origin: o.rect.origin, size: { width: o.rect.size.width * 1.5, height: o.rect.size.height * 1.5 } },
    });
  });
  await page.waitForTimeout(800);

  const saved = readFileSync(await saveAndPath(page)).toString('latin1');
  expect((saved.match(/\/Subtype\s*\/Stamp/g) ?? []).length).toBe(4);
  expect(saved).toContain('BIZUDPGothic');
  // 丸（縦書き）はハンコ用の書体（毛筆）が埋め込まれる
  expect(saved).toContain('YujiSyuku');
});

async function saveAndPath(page: import('@playwright/test').Page): Promise<string> {
  const bytes = await saveVia(page, '新ファイルで保存');
  const path = '_spike-out/e2e_stamps.pdf';
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('_spike-out', { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
