import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, addText, annotationTypes, saveVia, selectTool } from './helpers';

// PdfAnnotationSubtype from @embedpdf/models
const FREETEXT = 3;
const SQUARE = 5;
const HIGHLIGHT = 9;
const STAMP = 13;
const INK = 15;

interface Summary {
  id: string;
  type: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  text?: string;
  ink?: { x: number; y: number };
  segment?: { x: number; y: number };
}

const summaries = (page: Page): Promise<Summary[]> =>
  page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().map(
      (a: {
        object: Summary & {
          custom?: { pdfa?: { text?: string } };
          inkList?: { points: { x: number; y: number }[] }[];
          segmentRects?: { origin: { x: number; y: number } }[];
        };
      }) => ({
        id: a.object.id,
        type: a.object.type,
        rect: a.object.rect,
        text: a.object.custom?.pdfa?.text,
        ink: a.object.inkList?.[0].points[0],
        segment: a.object.segmentRects?.[0].origin,
      }),
    ),
  );

const selectAll = (page: Page) =>
  page.evaluate(() => {
    const a = window.__pdf.annotations;
    a.setSelection(a.getAnnotations().map((x: { object: { id: string } }) => x.object.id));
  });

const selectedIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__pdf.annotations.getSelectedAnnotations().map((x: { object: { id: string } }) => x.object.id));

/** Number of dark pixels in the rendered appearance of an annotation (0 = nothing drawn) */
const inkedPixels = (page: Page, id: string) =>
  page.evaluate(async (id: string) => {
    const a = window.__pdf.annotations;
    const docId = window.__pdf.docs.getActiveDocument().id;
    const { object } = a.getAnnotationById(id);
    const blob: Blob = await a
      .forDocument(docId)
      .renderAnnotation({ pageIndex: object.pageIndex, annotation: object, options: { scaleFactor: 2 } })
      .toPromise();
    const bitmap = await createImageBitmap(blob);
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 384) n++;
    return n;
  }, id);

test('テキスト注釈を Ctrl+C → Ctrl+V で複製し、貼るたびに少しずつずらす', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await addText(page, box.x + 320, box.y + 395, '複製テスト');
  await selectTool(page, '選択');
  const [original] = await summaries(page);

  await selectAll(page);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個コピーしました（Ctrl+V で貼り付け）');

  await page.keyboard.press('Control+v');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個貼り付けました');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(500);

  const all = await summaries(page);
  expect(all.map((a) => a.type)).toEqual([STAMP, STAMP, STAMP]);
  expect(all.map((a) => a.text)).toEqual(['複製テスト', '複製テスト', '複製テスト']);
  expect(new Set(all.map((a) => a.id)).size).toBe(3);
  expect(all[1].rect.origin.x).toBeCloseTo(original.rect.origin.x + 10, 3);
  expect(all[1].rect.origin.y).toBeCloseTo(original.rect.origin.y + 10, 3);
  expect(all[2].rect.origin.x).toBeCloseTo(original.rect.origin.x + 20, 3);
  expect(all[2].rect.size).toEqual(original.rect.size);
  // The last copy is selected (ready to drag), and its appearance is drawn like the original
  expect(await selectedIds(page)).toEqual([all[2].id]);
  const originalInk = await inkedPixels(page, original.id);
  expect(originalInk).toBeGreaterThan(50);
  expect(await inkedPixels(page, all[2].id)).toBe(originalInk);

  // Undo removes the paste
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect(await annotationTypes(page)).toEqual([STAMP, STAMP]);

  // The copy survives saving and reopening
  const saved = await saveVia(page, '注釈付きで保存');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'saved.pdf', mimeType: 'application/pdf', buffer: saved });
  await page.waitForSelector('.page img');
  await page.waitForTimeout(800);
  expect((await summaries(page)).map((a) => a.text)).toEqual(['複製テスト', '複製テスト']);
});

test('四角・手書き・ハイライトをまとめて複製すると中の座標も一緒にずれる', async ({ page }) => {
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
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 300 + i * 12, box.y + 1000 + (i % 2) * 20, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(1500); // ink commitDelay

  await selectTool(page, 'ハイライト');
  await page.mouse.move(box.x + 52 * scale, box.y + 316 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 168 * scale, box.y + 316 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await selectTool(page, '選択');
  const before = await summaries(page);
  expect(before.map((a) => a.type).sort()).toEqual([SQUARE, HIGHLIGHT, INK].sort());

  await selectAll(page);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 3 個コピーしました（Ctrl+V で貼り付け）');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 3 個貼り付けました');

  const after = await summaries(page);
  expect(after).toHaveLength(6);
  const pasted = after.slice(3);
  expect(await selectedIds(page)).toEqual(expect.arrayContaining(pasted.map((a) => a.id)));
  for (const [i, src] of before.entries()) {
    const copy = pasted[i];
    expect(copy.type).toBe(src.type);
    expect(copy.rect.origin.x).toBeCloseTo(src.rect.origin.x + 10, 3);
    expect(copy.rect.origin.y).toBeCloseTo(src.rect.origin.y + 10, 3);
    if (src.ink) expect(copy.ink).toEqual({ x: src.ink.x + 10, y: src.ink.y + 10 });
    if (src.segment) expect(copy.segment).toEqual({ x: src.segment.x + 10, y: src.segment.y + 10 });
  }
});

test('回転したスタンプも回転を保ったまま複製する', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  await page.locator('.toolbar button', { hasText: 'スタンプ' }).click();
  await page.waitForSelector('.stamp-panel');
  await page.locator('.stamp-preset[title^="四角"]').first().click();
  await page.mouse.click(box.x + 600, box.y + 600);
  await page.waitForTimeout(900);
  // Rotate by 90° the way the rotation handle does (rect = bounding box, unrotatedRect = the original rect)
  await page.evaluate(() => {
    const a = window.__pdf.annotations;
    const o = a.getAnnotations()[0].object;
    const r = o.rect;
    const cx = r.origin.x + r.size.width / 2;
    const cy = r.origin.y + r.size.height / 2;
    a.updateAnnotation(0, o.id, {
      rotation: 90,
      unrotatedRect: r,
      rect: { origin: { x: cx - r.size.height / 2, y: cy - r.size.width / 2 }, size: { width: r.size.height, height: r.size.width } },
    });
    a.selectAnnotation(0, o.id);
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個貼り付けました');

  const [src, copy] = await page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().map((a: { object: { id: string; rotation?: number } }) => ({
      id: a.object.id,
      rotation: a.object.rotation,
    })),
  );
  expect(copy.rotation).toBe(90);
  const srcInk = await inkedPixels(page, src.id);
  expect(srcInk).toBeGreaterThan(50);
  expect(await inkedPixels(page, copy.id)).toBe(srcInk);
});

test('既存の FreeText は外観ごとスタンプとして複製する', async ({ page }) => {
  await openPdf(page, 'sample-ja-form.pdf');
  const id = await page.evaluate(() => {
    const a = window.__pdf.annotations;
    a.createAnnotation(0, {
      type: 3,
      id: 'freetext-1',
      pageIndex: 0,
      rect: { origin: { x: 100, y: 500 }, size: { width: 120, height: 30 } },
      contents: 'FreeText ABC',
      fontFamily: 0,
      fontSize: 14,
      fontColor: '#000000',
      textAlign: 0,
      verticalAlign: 0,
      opacity: 1,
      flags: ['print'],
    });
    return 'freetext-1';
  });
  await page.waitForTimeout(500);
  await page.evaluate((id: string) => window.__pdf.annotations.selectAnnotation(0, id), id);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個コピーしました（Ctrl+V で貼り付け）');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個貼り付けました');

  const [src, copy] = await summaries(page);
  expect([src.type, copy.type]).toEqual([FREETEXT, STAMP]);
  expect(copy.rect.size).toEqual(src.rect.size);
  const srcInk = await inkedPixels(page, src.id);
  expect(srcInk).toBeGreaterThan(50);
  expect(await inkedPixels(page, copy.id)).toBe(srcInk);
});

test('文字をコピーした後の Ctrl+V では注釈を貼らない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPdf(page, 'sample-scaled-tf.pdf');
  const { box, scale } = await pageGeometry(page);
  await selectTool(page, '四角');
  await page.mouse.move(box.x + 300, box.y + 1100);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 1200, { steps: 10 });
  await page.mouse.up();
  await selectTool(page, '選択');
  await selectAll(page);
  await page.keyboard.press('Control+c');

  // Trace the first line (sample-scaled-tf.pdf: 12pt at x=60, baseline y=100)
  await page.mouse.move(box.x + 62 * scale, box.y + 95 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 170 * scale, box.y + 95 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した文字をコピーしました');

  await page.keyboard.press('Control+v');
  await page.waitForTimeout(500);
  expect(await annotationTypes(page)).toEqual([SQUARE]);
});

test('範囲を囲んだ後に注釈を選び直すと、Ctrl+C は範囲の画像でなく注釈をコピーする', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPdf(page, 'sample-scaled-tf.pdf');
  const { box, scale } = await pageGeometry(page);
  await selectTool(page, '四角');
  await page.mouse.move(box.x + 300, box.y + 1100);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 1200, { steps: 10 });
  await page.mouse.up();
  await selectTool(page, '選択');

  // A region on empty space is kept, and Ctrl+C copies it as an image
  await page.mouse.move(box.x + 300 * scale, box.y + 300 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 400 * scale, box.y + 380 * scale, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.region-select')).toHaveCount(1);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('選択した範囲を画像としてコピーしました');

  // Click the square's top edge to select it (an unfilled square is hit on its stroke; the status bar moved the page)
  const [square] = await summaries(page);
  const now = await pageGeometry(page);
  const r = square.rect;
  await page.mouse.click(now.box.x + (r.origin.x + r.size.width / 2) * now.scale, now.box.y + r.origin.y * now.scale + 1);
  await expect.poll(() => selectedIds(page)).toHaveLength(1);
  await expect(page.locator('.region-select')).toHaveCount(0);
  await page.keyboard.press('Control+c');
  await expect(page.locator('.status-bar')).toHaveText('注釈を 1 個コピーしました（Ctrl+V で貼り付け）');
});
