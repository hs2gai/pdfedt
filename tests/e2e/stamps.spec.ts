import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, saveVia } from './helpers';

const STAMP = 13;

async function placeStamp(page: Page, selector: string, x: number, y: number, fill: Record<string, string> = {}) {
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
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);

  // Presets: box (top line, date, name) / date seal (department, short date, name) / round vertical (name)
  await placeStamp(page, '.stamp-preset[title^="四角"]', box.x + 900, box.y + 300, { 下段: '山田' });
  await placeStamp(page, '.stamp-preset[title^="データ印"]', box.x + 900, box.y + 500, {
    上段: '総務部',
    下段: '山田',
  });
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

  // The tool returns to select after one placement (no repeated stamping)
  await expect(page.locator('.stamp-panel')).toHaveCount(0);

  // Custom format (Excel-style)
  await page.locator('.toolbar button', { hasText: 'スタンプ' }).click();
  await page.locator('.stamp-preset[title^="四角"]').click();
  await page.locator('.stamp-fields label', { hasText: '日付' }).locator('select').selectOption('custom');
  await page.locator('.stamp-fields input.date-custom').fill('yyyy-mm-dd aaa');
  await expect(page.locator('.stamp-fields label', { hasText: '書式' }).locator('.stamp-hint')).toHaveText(
    /^→ \d{4}-\d{2}-\d{2} [日月火水木金土]$/,
  );

  // Box: with no date and an empty bottom line, the second row collapses and the stamp gets shorter
  await page.locator('.stamp-fields label', { hasText: '日付' }).locator('select').selectOption('none');
  await page.locator('.stamp-fields label', { hasText: '下段' }).locator('input').fill('');
  await page.mouse.click(box.x + 600, box.y + 300);
  await page.waitForTimeout(900);
  const heights: number[] = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { rect: { size: { height: number } } } }) => a.object.rect.size.height),
  );
  expect(heights[3]).toBeLessThan(heights[0] - 10); // 38pt → 26pt

  // The appearance (embedded font) survives an aspect-preserving resize
  await page.evaluate(() => {
    const a = window.__pdf.annotations;
    const o = a.getAnnotations()[0].object;
    a.updateAnnotation(o.pageIndex, o.id, {
      rect: { origin: o.rect.origin, size: { width: o.rect.size.width * 1.5, height: o.rect.size.height * 1.5 } },
    });
  });
  await page.waitForTimeout(800);

  const saved = (await saveVia(page, '新ファイルで保存')).toString('latin1');
  expect((saved.match(/\/Subtype\s*\/Stamp/g) ?? []).length).toBe(4);
  expect(saved).toContain('BIZUDPGothic');
  // The round (vertical) stamp embeds a seal typeface (brush style)
  expect(saved).toContain('YujiSyuku');
});

test('押したスタンプを「編集」で書き直すと、押した日付・中心・倍率を保ったまま作り直される', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await placeStamp(page, '.stamp-preset[title^="四角"]', box.x + 900, box.y + 300, { 下段: '山田' });

  type Rect = { origin: { x: number; y: number }; size: { width: number; height: number } };
  type Obj = { id: string; rect: Rect; custom: { pdfa: { values: Record<string, string>; color: string } } };
  const objects = (): Promise<Obj[]> =>
    page.evaluate(() => window.__pdf.annotations.getAnnotations().map((a: { object: Obj }) => a.object));

  // Emulate a stamp pressed on an earlier day and then enlarged 2x around its center
  const before = (await objects())[0];
  const center = {
    x: before.rect.origin.x + before.rect.size.width / 2,
    y: before.rect.origin.y + before.rect.size.height / 2,
  };
  await page.evaluate(
    ({ o, c }) => {
      const a = window.__pdf.annotations;
      const { width, height } = o.rect.size;
      a.updateAnnotation(0, o.id, {
        rect: { origin: { x: c.x - width, y: c.y - height }, size: { width: width * 2, height: height * 2 } },
        custom: { pdfa: { ...o.custom.pdfa, values: { ...o.custom.pdfa.values, 日付: '令和7年1月1日' } } },
      });
      a.selectAnnotation(0, o.id);
    },
    { o: before, c: center },
  );

  // Cancel leaves the stamp as it is
  await page.locator('.annot-menu button', { hasText: '編集' }).click();
  await expect(page.locator('.stamp-panel .stamp-edit-preview')).toBeVisible();
  await expect(page.locator('.stamp-panel .stamp-grid')).toHaveCount(0);
  await page.locator('.stamp-panel button', { hasText: 'キャンセル' }).click();
  await expect(page.locator('.stamp-panel')).toHaveCount(0);
  expect((await objects()).map((o) => o.id)).toEqual([before.id]);

  await page.evaluate((id) => window.__pdf.annotations.selectAnnotation(0, id), before.id);
  await page.locator('.annot-menu button', { hasText: '編集' }).click();
  // The date is an editable field holding the stamped value, not today's date
  await expect(page.locator('.stamp-fields label', { hasText: '日付' }).locator('input')).toHaveValue('令和7年1月1日');
  await expect(page.locator('.stamp-fields label', { hasText: '日付' }).locator('select')).toHaveCount(0);
  await page.locator('.stamp-fields label', { hasText: '下段' }).locator('input').fill('佐藤');
  await page.locator('.stamp-fields .swatch[title="青"]').click();
  await page.locator('.stamp-panel button', { hasText: '更新' }).click();
  await page.waitForTimeout(900);
  await expect(page.locator('.stamp-panel')).toHaveCount(0);

  const after = await objects();
  expect(after).toHaveLength(1);
  expect(after[0].id).not.toBe(before.id);
  expect(after[0].custom.pdfa.values).toMatchObject({ 上段: '承認', 日付: '令和7年1月1日', 下段: '佐藤' });
  expect(after[0].custom.pdfa.color).toBe('blue');
  const r = after[0].rect;
  expect(r.origin.x + r.size.width / 2).toBeCloseTo(center.x, 1);
  expect(r.origin.y + r.size.height / 2).toBeCloseTo(center.y, 1);
  expect(r.size.width).toBeCloseTo(before.rect.size.width * 2, 1);
  expect(r.size.height).toBeCloseTo(before.rect.size.height * 2, 1);
});
