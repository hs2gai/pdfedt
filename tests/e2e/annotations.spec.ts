import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, pageGeometry, addText, annotationTypes, saveVia, sample, selectTool } from './helpers';

// PdfAnnotationSubtype from @embedpdf/models
const TEXT = 1;
const SQUARE = 5;
const HIGHLIGHT = 9;
const STAMP = 13;
const INK = 15;

test.describe('テキスト注釈', () => {
  test('作成 → 編集 → 削除', async ({ page }) => {
    await openPdf(page, 'sample-ja-form.pdf');
    const { box } = await pageGeometry(page);
    await addText(page, box.x + 320, box.y + 395, '山田　太郎');
    expect(await annotationTypes(page)).toEqual([STAMP]);

    // Select it and rewrite the text from the edit menu
    await page.evaluate(() => {
      const a = window.__pdf.annotations;
      const o = a.getAnnotations()[0].object;
      a.selectAnnotation(o.pageIndex, o.id);
    });
    await page.locator('.annot-menu button', { hasText: '編集' }).click();
    await expect(page.locator('.popover textarea')).toHaveValue('山田　太郎');
    await page.fill('.popover textarea', '山田　太郎（編集後）');
    await page.locator('.popover button', { hasText: '確定' }).click();
    await page.waitForTimeout(800);
    const texts = await page.evaluate(() =>
      window.__pdf.annotations
        .getAnnotations()
        .map((a: { object: { custom?: { pdfa?: { text: string } } } }) => a.object.custom?.pdfa?.text),
    );
    expect(texts).toEqual(['山田　太郎（編集後）']);

    // Delete with the Delete key
    await page.evaluate(() => {
      const a = window.__pdf.annotations;
      const o = a.getAnnotations()[0].object;
      a.selectAnnotation(o.pageIndex, o.id);
    });
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    expect(await annotationTypes(page)).toEqual([]);
  });
});

test.describe('描画ツール', () => {
  test('四角・手書き・ハイライト・付箋が作成され印刷フラグを持つ', async ({ page }) => {
    await openPdf(page, 'sample-ja-form.pdf');
    const { box, scale } = await pageGeometry(page);

    await selectTool(page, '四角');
    await page.mouse.move(box.x + 300, box.y + 1100);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 1200, { steps: 10 });
    await page.mouse.up();

    await selectTool(page, '手書き');
    await page.mouse.move(box.x + 300, box.y + 1000);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(box.x + 300 + i * 12, box.y + 1000 + Math.sin(i / 2) * 20, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(1500); // ink commitDelay

    // Trace the body sentence "I hereby apply as stated above." (pt, top-left origin, 50,311 – 170,321)
    await selectTool(page, 'ハイライト');
    await page.mouse.move(box.x + 52 * scale, box.y + 316 * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + 168 * scale, box.y + 316 * scale, { steps: 8 });
    await page.mouse.up();

    await selectTool(page, '付箋');
    await page.mouse.click(box.x + 500, box.y + 300);
    await page.waitForTimeout(800);
    await page.locator('.annot-menu button', { hasText: 'コメント' }).click();
    await page.fill('.annot-comment textarea', '要確認');
    await page.locator('.annot-comment button', { hasText: '保存' }).click();
    await page.waitForTimeout(500);

    type Summary = { type: number; flags: string[]; contents?: string };
    const annots: Summary[] = await page.evaluate(() =>
      window.__pdf.annotations
        .getAnnotations()
        .map((a: { object: Summary }) => ({ type: a.object.type, flags: a.object.flags, contents: a.object.contents })),
    );
    expect(annots.map((a) => a.type).sort()).toEqual([TEXT, SQUARE, HIGHLIGHT, INK].sort());
    for (const a of annots) expect(a.flags).toContain('print');
    expect(annots.find((a) => a.type === TEXT)?.contents).toBe('要確認');
  });
});

test.describe('保存', () => {
  test.beforeEach(async ({ page }) => {
    // Disable the File System Access API to force the download path
    await page.addInitScript(() => {
      // @ts-expect-error test only
      delete window.showSaveFilePicker;
    });
  });

  test('注釈付き保存は元ファイルのバイト列を保持する', async ({ page }) => {
    await openPdf(page, 'sample-ja-form.pdf');
    const { box } = await pageGeometry(page);
    await addText(page, box.x + 320, box.y + 395, '保存テスト');

    const original = readFileSync(sample('sample-ja-form.pdf'));
    const saved = await saveVia(page, '注釈付きで保存');
    expect(saved.length).toBeGreaterThan(original.length);
    expect(saved.subarray(0, original.length).equals(original)).toBe(true);
    expect(saved.toString('latin1')).toMatch(/\/Subtype\s*\/Stamp/);
    // Slimming: unchanged objects are not in the increment (roughly the annotation + a subset font)
    expect(saved.length - original.length).toBeLessThan(12_000);

    // The saved file reopens and the annotation is still there (verified by PDFium itself)
    await page.locator('input[type=file]').first().setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: saved });
    await page.waitForSelector('.page img');
    await page.waitForTimeout(800);
    expect(await annotationTypes(page)).toEqual([STAMP]);
  });

  test('確定保存とフラット化', async ({ page }) => {
    await openPdf(page, 'sample-ja-form.pdf');
    const { box } = await pageGeometry(page);
    await addText(page, box.x + 320, box.y + 395, '提出');

    const full = await saveVia(page, '新ファイルで保存');
    expect(full.toString('latin1')).toMatch(/\/Subtype\s*\/Stamp/);

    const flat = await saveVia(page, '確定して書き出し');
    expect(flat.toString('latin1')).not.toMatch(/\/Subtype\s*\/Stamp/);
    expect(flat.toString('latin1')).toContain('/FontFile2'); // embedded font of the flattened text
  });
});

test.describe('文書検査', () => {
  test('署名・フォームをバッジで示す', async ({ page }) => {
    await openPdf(page, 'sample-signed.pdf');
    await expect(page.locator('.badges')).toContainText('電子署名1');
    await expect(page.locator('.badges')).not.toContainText('フォーム');

    await openPdf(page, 'sample-form.pdf');
    await expect(page.locator('.badges')).toContainText('フォーム（4項目）');
  });
});
