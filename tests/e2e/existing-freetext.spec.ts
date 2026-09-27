import { test, expect } from '@playwright/test';
import { openPdf } from './helpers';
import { existsSync, readFileSync } from 'node:fs';

/** 手元だけにある検証用文書（Acrobat の日本語タイプライター注釈を含む。リポジトリには入れない） */
const FREETEXT_PDF = 'docs/private/test.pdf';

/**
 * 他ツールで作られた FreeText は元の外観を保ち、リサイズできず、移動しても外観が作り直されないこと。
 */
test('既存の FreeText は外観を保ったまま移動できる', async ({ page }) => {
  test.skip(!existsSync(FREETEXT_PDF), '検証用の FreeText 入り PDF が無い環境');
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
  });
  await openPdf(page, `../${FREETEXT_PDF}`);

  const before = await page.evaluate(() => {
    const a = window.__pdf.annotations;
    const ft = a.getAnnotations().find((x: { object: { type: number } }) => x.object.type === 3);
    a.selectAnnotation(ft.object.pageIndex, ft.object.id);
    return { id: ft.object.id, rect: ft.object.rect };
  });
  await page.waitForSelector('.annot-menu');
  // リサイズハンドルは出ない（削除メニューだけ）
  await expect(page.locator('.annot-menu')).toContainText('削除');
  await expect(page.locator('.annot-menu')).not.toContainText('編集');

  // ドラッグで移動
  const box = await page.locator('.page').first().boundingBox();
  const pdfWidth = 595.276;
  const scale = box!.width / pdfWidth;
  const cx = box!.x + (before.rect.origin.x + before.rect.size.width / 2) * scale;
  const cy = box!.y + (before.rect.origin.y + before.rect.size.height / 2) * scale;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  const after = await page.evaluate((id: string) => window.__pdf.annotations.getAnnotationById(id).object.rect, before.id);
  expect(after.origin.x).toBeGreaterThan(before.rect.origin.x + 10);

  // 保存して外観ストリームが元のフォント（MicrosoftYaHeiUI）のままか確認
  await page.locator('.toolbar .save-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.menu-list button', { hasText: '新ファイルで保存' }).click(),
  ]);
  await download.saveAs('_spike-out/existing-freetext.pdf');
  const saved = readFileSync('_spike-out/existing-freetext.pdf').toString('latin1');
  // 元の外観（Acrobat が埋め込んだフォントを参照する /AP）がそのまま残り、Helvetica で作り直されていない
  expect(saved).toMatch(/\/Resources\s*<<\s*\/Font\s*<<\s*\/AAAAAA\+MicrosoftYaHeiUI/);
});
