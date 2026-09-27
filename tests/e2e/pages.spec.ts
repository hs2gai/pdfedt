import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openPdf, sample } from './helpers';

/** 各ページの本文（先頭の文字列）を順に返す */
async function pageTexts(page: Page): Promise<string[]> {
  await page.waitForTimeout(600);
  return page.evaluate(async () => {
    const rt = window.__pdf.runtime;
    const doc = window.__pdf.docs.getActiveDocument();
    const out: string[] = [];
    for (const p of doc.pages) {
      const t = await rt.engine.getPageTextRects(doc, p).toPromise();
      // 抽出結果に制御文字が混じることがあるので取り除く
      out.push(
        t
          .map((r: { content: string }) => r.content)
          .join('')
          .replace(/[\x00-\x1f]/g, ''),
      );
    }
    return out;
  });
}

test('サムネイルからページを削除・並べ替え・PDF の追加ができ、保存は確定保存に限られる', async ({ page }) => {
  await openPdf(page, 'sample-pages.pdf');
  await expect(page.locator('.thumb')).toHaveCount(3);
  expect(await pageTexts(page)).toEqual(['ページA', 'ページB', 'ページC']);

  // 2 ページ目を選んで Delete → 確認 → 削除
  await page.locator('.thumb').nth(1).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.modal')).toContainText('ページ2を削除しますか');
  await page.locator('.modal button', { hasText: '削除する' }).click();
  await page.waitForSelector('.page img');
  await expect(page.locator('.thumb')).toHaveCount(2);
  expect(await pageTexts(page)).toEqual(['ページA', 'ページC']);
  await expect(page.locator('.status-bar')).toContainText('ページ2を削除しました');

  // 2 ページ目（C）を 1 ページ目の上半分へドラッグ → 先頭に移動
  const first = page.locator('.thumb').nth(0);
  const box = (await first.boundingBox())!;
  await page.locator('.thumb').nth(1).hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2, box.y + 8, { steps: 2 });
  await page.mouse.up();
  await page.waitForSelector('.page img');
  expect(await pageTexts(page)).toEqual(['ページC', 'ページA']);

  // PDF ファイルをサムイルの末尾（一覧の余白）に落とすと、そのページが追加される
  const extra = readFileSync(sample('sample-msmincho.pdf')).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'extra.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const pane = document.querySelector('.thumbs')!;
    const r = pane.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.bottom - 5 };
    pane.dispatchEvent(new DragEvent('dragover', init));
    pane.dispatchEvent(new DragEvent('drop', init));
  }, extra);
  await page.waitForSelector('.page img');
  await expect(page.locator('.thumb')).toHaveCount(3);
  const texts = await pageTexts(page);
  expect(texts.slice(0, 2)).toEqual(['ページC', 'ページA']);
  expect(texts[2]).toContain('見本の文書');

  // ページ構成を変えた文書は追記保存できない
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
});
