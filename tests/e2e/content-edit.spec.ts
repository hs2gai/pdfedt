import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes, selectTool } from './helpers';

/** Phase 3: 本文編集モード（ゲート → 選択・移動・文字置換・矩形削除 → 別名保存） */
test('本文編集モードで移動・置換・削除して確定保存できる', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error テスト用
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-ja-form.pdf');

  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await expect(page.locator('.modal')).toContainText('元の内容が書き換わり');
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  // バナーの分だけページの位置がずれるので、モードに入ってから測る
  const { box, scale } = await pageGeometry(page);

  // モード中でも注釈ツールはそのまま使える（テキスト注釈を置く）。「本文」ツールに戻すと本文の選択に戻る
  await addText(page, box.x + 400, box.y + 900, 'モード中の注釈');
  expect(await annotationTypes(page)).toHaveLength(1);
  await selectTool(page, '本文');
  await page.waitForTimeout(300);
  // 「本文」ツールで注釈をクリックすると、その注釈が選ばれて選択ツールに切り替わる
  await page.mouse.click(box.x + 410, box.y + 910);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pdf.annotations.getSelectedAnnotations().length)).toBe(1);
  await expect(page.locator('.toolbar .icon-btn[aria-label="選択"]')).toHaveClass(/active/);
  // 逆に、選択ツールで注釈のない本文（「交付申請書」の見出し）をクリックすると「本文」ツールに戻ってそれが選ばれる
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + 300 * scale, box.y + 54 * scale);
  await expect(page.locator('.toolbar .icon-btn[aria-label="本文"]')).toHaveClass(/active/);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.waitForTimeout(300);

  // 「○○市長　殿」を選んで右下へ移動
  await page.mouse.click(box.x + 70 * scale, box.y + 116 * scale);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.mouse.move(box.x + 70 * scale, box.y + 116 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 110 * scale, box.y + 136 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // 「上記のとおり申請します。」を置換
  await page.mouse.dblclick(box.x + 80 * scale, box.y + 316 * scale);
  await expect(page.locator('.popover input')).toHaveValue('上記のとおり申請します。');
  await page.fill('.popover input', '以上のとおり申請いたします。');
  await page.locator('.popover button', { hasText: '置換' }).click();
  await page.waitForTimeout(800);

  // 「令和　年　月　日」を矩形選択して削除
  await page.mouse.move(box.x + 440 * scale, box.y + 85 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 560 * scale, box.y + 105 * scale, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);

  // 増分保存は使えず、確定保存は別名になる
  await page.locator('.toolbar .save-btn').click();
  await expect(page.locator('.menu-list button', { hasText: '注釈付きで保存' })).toBeDisabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('.menu-list button')
      .filter({ has: page.locator('.menu-label', { hasText: '新ファイルで保存' }) })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe('sample-ja-form_n.pdf');

  // 書き出した PDF を開き直し、置換後の文字が本文にあり、消した文字が無い
  const bytes = (await import('node:fs')).readFileSync((await download.path())!);
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
  expect(text).toContain('以上のとおり申請いたします。');
  expect(text).not.toContain('令和');
});
