import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, pdfStreams, saveVia, selectTool, dragPt, reopenAfterContentEdit } from './helpers';

// sample-vertical.pdf (A4, Identity-V): columns centered at x = 500 / 480 / 460 from y = 100 (top-left origin, 12pt).
// Column 1 is set with "1 Tf" + a scaled text matrix (InDesign style), the others with "12 Tf".
// A horizontal line "横書きの行です" sits at baseline y = 400 from x = 60. In PDF coordinates the page is 842pt tall

test.beforeEach(async ({ page }) => {
  // Disable the File System Access API to force the download path
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
});

/** Drags on the first page between two points given in pt */
const streamTexts = (bytes: Buffer) => pdfStreams(bytes).map((s) => s.data.toString('latin1'));

test('縦書きの列の下線は右側、取消線は中央に縦線で引く（横書きの行は従来どおり）', async ({ page }) => {
  await openPdf(page, 'sample-vertical.pdf');
  await selectTool(page, '下線');
  await dragPt(page, [500, 104], [500, 190], 600);
  await selectTool(page, '取消線');
  await dragPt(page, [480, 104], [480, 190], 600);
  await selectTool(page, '下線');
  await dragPt(page, [62, 395], [140, 395], 600);

  const saved = await saveVia(page, '注釈付きで保存');
  const pdf = saved.toString('latin1');
  const streams = streamTexts(saved);
  // The glyph boxes of a column are widened on the right by a quarter of its width (text-geometry.ts):
  // column 1 (glyphs x 494–506) becomes 494–509, column 2 (474–486) becomes 474–489.
  // Underline: a thin vertical line just inside the right edge of column 1, clear of the glyphs
  expect(streams.some((s) => /\n0\.75 w 508\.625 742 m 508\.625 6\d\d(\.\d+)? l S\n/.test(s))).toBe(true);
  // Strikeout: a thin vertical line through the middle of column 2
  expect(streams.some((s) => /\n0\.75 w 481\.5 742 m 481\.5 6\d\d(\.\d+)? l S\n/.test(s))).toBe(true);
  // The horizontal line keeps PDFium's own horizontal underline
  expect(streams.some((s) => /60 442 m 143 442 l S/.test(s))).toBe(true);
  // QuadPoints of the vertical underline: the text flows down the left edge, the underline side is the right edge
  expect(pdf).toMatch(/\/QuadPoints\s*\[\s*494 742 494 6\d\d(\.\d+)? 509 742 509 6\d\d(\.\d+)?\s*\]/);
});

/** Thin colored bars drawn on the first page (markup previews and fallbacks), in pt relative to the page */
const bars = (page: Page) =>
  page.evaluate(() => {
    const pageEl = document.querySelector('.page') as HTMLElement;
    const origin = pageEl.getBoundingClientRect();
    const s = origin.width / window.__pdf.docs.getActiveDocument().pages[0].size.width;
    return [...pageEl.querySelectorAll<HTMLElement>('div')]
      .filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const r = el.getBoundingClientRect();
        return (
          bg !== 'rgba(0, 0, 0, 0)' &&
          bg !== 'transparent' &&
          Math.min(r.width, r.height) <= 3 * s &&
          Math.max(r.width, r.height) > 4 * s
        );
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: (r.left - origin.left) / s, y: (r.top - origin.top) / s, w: r.width / s, h: r.height / s };
      });
  });

for (const [tool, from] of [
  ['下線', 104],
  ['取消線', 118],
] as const) {
  test(`縦中横（列の中で横に並べた "12"）や 1 字だけの区切りがあっても、${tool}は縦線になる`, async ({ page }) => {
    await openPdf(page, 'sample-vertical.pdf');
    const { box, scale } = await pageGeometry(page);
    // Column 4: 第 / "12" side by side / 回です, centered at x = 440. The selection breaks into segments there:
    // 第 (one glyph; the strikeout starts below it), "12" (wider than tall), 回です
    const inColumn = async () => (await bars(page)).filter((b) => b.x > 425 && b.x < 460);
    await selectTool(page, tool);
    await page.mouse.move(box.x + 440 * scale, box.y + from * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + 440 * scale, box.y + 165 * scale, { steps: 8 });
    // While dragging, and right after (before the appearance is loaded): only vertical bars
    const preview = await inColumn();
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.every((b) => b.h > b.w)).toBe(true);
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect((await inColumn()).every((b) => b.h > b.w)).toBe(true);

    // The saved appearance is one straight vertical line (the segments of the column are joined into one rect).
    // Ours start with "q"; an incremental save also keeps PDFium's first (unused) appearance
    const lines = streamTexts(await saveVia(page, '注釈付きで保存'))
      .filter((s) => s.startsWith('q '))
      .flatMap((s) => [...s.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)])
      .map((m) => m.slice(1).map(Number));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const [x1, , x2] of lines) expect(x1).toBe(x2);
    expect(new Set(lines.map(([x]) => x)).size).toBe(1);
  });
}

test('複数の列にまたがって選んでも、列ごとの縦線になる（隣の列とまとめない）。選び始めの 1 字でも縦線', async ({
  page,
}) => {
  await openPdf(page, 'sample-vertical.pdf');
  const { box, scale } = await pageGeometry(page);
  const at = (x: number, y: number) => [box.x + x * scale, box.y + y * scale] as const;
  const inColumns = async () => (await bars(page)).filter((b) => b.x > 445 && b.x < 515);
  await selectTool(page, '下線');
  await page.mouse.move(...at(500, 104));
  await page.mouse.down();
  // The first glyph alone
  await page.mouse.move(...at(500, 109), { steps: 3 });
  const first = await inColumns();
  expect(first.length).toBeGreaterThan(0);
  expect(first.every((b) => b.h > b.w)).toBe(true);
  // Down to column 3, through column 2
  await page.mouse.move(...at(460, 150), { steps: 10 });
  const preview = await inColumns();
  expect(preview.every((b) => b.h > b.w)).toBe(true);
  // One bar per column (centers about 20pt apart), none spanning two columns
  expect(new Set(preview.map((b) => Math.round((b.x + b.w / 2) / 10))).size).toBe(3);
  await page.mouse.up();
  await page.waitForTimeout(600);

  const lines = streamTexts(await saveVia(page, '注釈付きで保存'))
    .filter((s) => s.startsWith('q '))
    .flatMap((s) => [...s.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)])
    .map((m) => m.slice(1).map(Number));
  for (const [x1, , x2] of lines) expect(x1).toBe(x2);
  // The right edges of columns 1–3 (glyphs 494–506, 474–486, 454–466, widened by 3pt)
  expect([...new Set(lines.map(([x]) => x))].sort()).toEqual([468.625, 488.625, 508.625]);
});

test('縦書きの列を下線・取消線ツールで選んでいる間も、プレビューは列に沿った縦線になる', async ({ page }) => {
  await openPdf(page, 'sample-vertical.pdf');
  const { box, scale } = await pageGeometry(page);
  // Underline on column 1 (x 494–509 with the room on the right), strikeout on column 2 (x 474–489)
  for (const [tool, column, x] of [
    ['下線', 500, 508.6],
    ['取消線', 480, 481.5],
  ] as const) {
    await selectTool(page, tool);
    await page.mouse.move(box.x + column * scale, box.y + 104 * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + column * scale, box.y + 190 * scale, { steps: 8 });
    // While dragging: the preview is a bar running down the column, on its right side or through its middle
    // (the underline made in the first round is a vertical bar on column 1 as well)
    const preview = (await bars(page)).filter((b) => Math.abs(b.x + b.w / 2 - x) < 6);
    expect(preview).toHaveLength(1);
    expect(preview[0].h).toBeGreaterThan(60);
    expect(Math.abs(preview[0].x + preview[0].w / 2 - x)).toBeLessThan(2);
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
});

test('テキスト注釈を縦書きにでき、編集し直しても縦書きのまま', async ({ page }) => {
  await openPdf(page, 'sample-scaled-tf.pdf');
  const { box, scale } = await pageGeometry(page);
  await page.locator('.toolbar button', { hasText: 'テキスト' }).first().click();
  await page.mouse.click(box.x + 300 * scale, box.y + 200 * scale);
  await page.waitForSelector('.popover textarea');
  await page.fill('.popover textarea', '縦書き、PDF「見本」');
  await page.locator('.popover label', { hasText: '縦書き' }).locator('input').check();
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);

  const annotation = () =>
    page.evaluate(() => {
      const o = window.__pdf.annotations.getAnnotations()[0].object;
      return { rect: o.rect, pdfa: o.custom?.pdfa };
    });
  const first = await annotation();
  expect(first.pdfa).toMatchObject({ kind: 'text', text: '縦書き、PDF「見本」', vertical: true });
  // One column: much taller than wide
  expect(first.rect.size.height).toBeGreaterThan(first.rect.size.width * 4);

  // Re-editing keeps the vertical setting
  await page.evaluate(() => {
    const a = window.__pdf.annotations;
    const o = a.getAnnotations()[0].object;
    a.selectAnnotation(o.pageIndex, o.id);
  });
  await page.locator('.annot-menu button', { hasText: '編集' }).click();
  await expect(page.locator('.popover label', { hasText: '縦書き' }).locator('input')).toBeChecked();
  await page.fill('.popover textarea', '縦書き、PDF「見本」\n二列目');
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);
  const second = await annotation();
  expect(second.pdfa).toMatchObject({ vertical: true });
  // Two columns side by side
  expect(second.rect.size.width).toBeGreaterThan(first.rect.size.width * 1.5);

  // In the appearance, the Latin run is rotated 90° clockwise and the rest are single upright glyphs
  const streams = streamTexts(await saveVia(page, '注釈付きで保存'));
  // Editing recreates the annotation and the incremental save may still carry the old appearance, so take the
  // fullest one: 縦書き、「見本」 and 二列目 are 11 upright glyphs, PDF is one sideways run
  const shows = streams.filter((s) => /BT 0 -1 1 0 0 0 Tm/.test(s)).map((s) => s.match(/ Tj ET/g)!.length);
  expect(Math.max(...shows)).toBe(12);
});

test('本文編集で縦書きの文字を置換すると縦書き（Identity-V）のまま書き換わり、もう一度置換できる', async ({ page }) => {
  await openPdf(page, 'sample-vertical.pdf');
  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
  const { box, scale } = await pageGeometry(page);

  const replace = async (expected: string, text: string) => {
    await page.mouse.dblclick(box.x + 500 * scale, box.y + 150 * scale);
    await expect(page.locator('.popover input')).toHaveValue(expected);
    await page.fill('.popover input', text);
    await page.locator('.popover button', { hasText: '置換' }).click();
    await page.waitForTimeout(800);
  };
  // Column 1 ("1 Tf" + scaled matrix); then the replaced column again
  await replace('縦書きの見本です。「テスト」用ー', '置き換えた縦書き、PDF');
  await replace('置き換えた縦書き、PDF', '二度目の置換です');

  const bytes = await saveVia(page, '新ファイルで保存');
  // The new text uses our embedded font in vertical writing mode
  const fontDicts = bytes.toString('latin1').match(/<<[^<>]*\/Identity-V[^<>]*>>/g) ?? [];
  expect(fontDicts.some((d) => d.includes('PDFUGU+'))).toBe(true);

  // Reopen: the text reads back, in the place of the original column 1
  await reopenAfterContentEdit(page, bytes);
  const rects: { content: string; rect: { origin: { x: number; y: number }; size: { width: number } } }[] =
    await page.evaluate(async () => {
      const rt = window.__pdf.runtime;
      const doc = window.__pdf.docs.getActiveDocument();
      return rt.engine.getPageTextRects(doc, doc.pages[0]).toPromise();
    });
  const text = rects.map((r) => r.content).join('');
  expect(text).toContain('二度目の置換です');
  expect(text).not.toContain('縦書きの見本');
  const replaced = rects.filter((r) => /[二度目の置換です]/.test(r.content) && r.rect.origin.x > 490);
  expect(replaced.length).toBeGreaterThan(0);
  for (const r of replaced) {
    expect(r.rect.origin.x).toBeGreaterThan(490);
    expect(r.rect.origin.x + r.rect.size.width).toBeLessThan(510);
    expect(r.rect.origin.y).toBeGreaterThan(95);
  }
});
