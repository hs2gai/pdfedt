import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry } from './helpers';

const STAMP = 13;

test('スタンプ作成画面で作例を編集して保存し、エディタから押せる', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/#/stamps');
  await page.waitForSelector('.se-canvas-wrap');
  await expect(page.locator('.se-list .se-item')).toHaveCount(4);

  // 丸（横書き）を元に、文字要素をドラッグで動かし、名前を付けて保存
  await page.locator('.se-item[title="丸（横書き）"]').click();
  const hit = page.locator('.se-overlay .se-hit').nth(1);
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.se-element h3')).toHaveText('文字');
  await page.locator('.se-element input:not([type=number]):not([type=checkbox])').first().fill('{文字:検}');
  await page.locator('.se-props > label input').first().fill('検印');
  await page.locator('.se-actions button.primary').click();
  await expect(page.locator('.se-status')).toContainText('保存しました');
  await expect(page.locator('.se-list .se-item')).toHaveCount(5);

  // 要素の追加と削除
  await page.locator('.se-tools button', { hasText: '線' }).click();
  await expect(page.locator('.se-overlay .se-hit')).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(page.locator('.se-overlay .se-hit')).toHaveCount(2);

  // エディタ側のスタンプパネルに自作が現れ、押せる
  await openPdf(page, 'sample-ja-form.pdf');
  const { box: pageBox } = await pageGeometry(page);
  await page.locator('.toolbar button', { hasText: 'スタンプ' }).click();
  await page.waitForSelector('.stamp-panel');
  // 自作には左上に目印が付く
  await expect(page.locator('.stamp-preset[title^="検印"] .stamp-mine')).toHaveText('★');
  await expect(page.locator('.stamp-preset[title^="四角"] .stamp-mine')).toHaveCount(0);
  await page.locator('.stamp-preset[title^="検印"]').click();
  await expect(page.locator('.stamp-fields label', { hasText: '文字' }).locator('input')).toHaveValue('検');
  await page.mouse.click(pageBox.x + 900, pageBox.y + 300);
  await page.waitForTimeout(900);
  const annots: { type: number; name: string }[] = await page.evaluate(() =>
    window.__pdf.annotations
      .getAnnotations()
      .map((a: { object: { type: number; custom?: { pdfa?: { name: string } } } }) => ({
        type: a.object.type,
        name: a.object.custom?.pdfa?.name,
      })),
  );
  expect(annots).toEqual([{ type: STAMP, name: '検印' }]);
});
