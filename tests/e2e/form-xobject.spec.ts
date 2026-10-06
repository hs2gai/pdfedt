import { test, expect, type Page } from '@playwright/test';
import { openPdf, pageGeometry, saveVia } from './helpers';

// sample-form-xobject.pdf: both pages show page 1 of sample-vertical.pdf through two nested Form XObjects,
// and the two pages share the inner form. Coordinates as in sample-vertical.pdf (top-left origin, pt):
// vertical columns centered at x = 500 / 480 / 460 from y = 100, a horizontal line at baseline y = 400 from x = 60

test.beforeEach(async ({ page }) => {
  // Disable the File System Access API to force the download path
  await page.addInitScript(() => {
    // @ts-expect-error test only
    delete window.showSaveFilePicker;
  });
});

async function startContentEdit(page: Page) {
  await openPdf(page, 'sample-form-xobject.pdf');
  await page.locator('.toolbar button', { hasText: '本文編集' }).click();
  await page.locator('.modal button', { hasText: '理解して編集する' }).click();
  await expect(page.locator('.content-edit-banner')).toBeVisible();
  await page.waitForTimeout(400);
}

/** Double-clicks at a point in pt on the first page and replaces the text shown in the dialog */
async function replaceAt(page: Page, at: [number, number], expected: string, text: string) {
  const { box, scale } = await pageGeometry(page);
  await page.mouse.dblclick(box.x + at[0] * scale, box.y + at[1] * scale);
  await expect(page.locator('.popover input')).toHaveValue(expected);
  await page.fill('.popover input', text);
  await page.locator('.popover button', { hasText: '置換' }).click();
  await page.waitForTimeout(800);
}

/** Text of each page of the open document, as PDFium extracts it */
const pageTexts = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const rt = window.__pdf.runtime;
    const doc = window.__pdf.docs.getActiveDocument();
    const out: string[] = [];
    for (const p of doc.pages) {
      const rects: { content: string }[] = await rt.engine.getPageTextRects(doc, p).toPromise();
      out.push(rects.map((r) => r.content).join(''));
    }
    return out;
  });

/** Saves as a new file and opens the result in place of the document */
async function saveAndReopen(page: Page): Promise<Buffer> {
  const bytes = await saveVia(page, '新ファイルで保存');
  await page.locator('.toolbar button', { hasText: '本文編集を終了' }).click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'edited.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.waitForSelector('.page img');
  await page.waitForTimeout(500);
  return bytes;
}

test('Form の中の横書きの文字を置換でき、Form を共有する他のページはそのまま', async ({ page }) => {
  await startContentEdit(page);
  await replaceAt(page, [80, 395], '横書きの行です', '置き換えた横書き');

  // Undo brings the text in the form back; redo replaces it again
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  expect((await pageTexts(page))[0]).toContain('横書きの行です');
  expect((await pageTexts(page))[0]).not.toContain('置き換えた横書き');
  await page.locator('.toolbar button', { hasText: 'やり直す' }).click();
  await page.waitForTimeout(400);
  expect((await pageTexts(page))[0]).toContain('置き換えた横書き');

  await saveAndReopen(page);
  const [first, second] = await pageTexts(page);
  expect(first).toContain('置き換えた横書き');
  expect(first).not.toContain('横書きの行です');
  // The rest of the form stays: the vertical columns
  expect(first).toContain('縦書きの見本');
  // Page 2 draws the same inner form, which keeps its text
  expect(second).toContain('横書きの行です');
  expect(second).not.toContain('置き換えた横書き');
});

/** On-screen rects of the selection frames, in pt on the first page */
const selectedRects = (page: Page) =>
  page.evaluate(() => {
    const layer = document.querySelector('.page .content-edit-layer') as HTMLElement;
    const scale = layer.getBoundingClientRect().width / window.__pdf.docs.getActiveDocument().pages[0].size.width;
    return [...layer.querySelectorAll<HTMLElement>('.ce-object.selected')].map((el) => ({
      x: el.offsetLeft / scale,
      y: el.offsetTop / scale,
      w: el.offsetWidth / scale,
      h: el.offsetHeight / scale,
    }));
  });

test('ページ全体を包む Form は選ばれず、中の文字を 1 つずつ選んで削除・取り消しできる', async ({ page }) => {
  await startContentEdit(page);
  const { box, scale } = await pageGeometry(page);
  // Empty space: the page-covering form is not picked
  await page.mouse.click(box.x + 300 * scale, box.y + 600 * scale);
  await expect(page.locator('.ce-object.selected')).toHaveCount(0);
  // The horizontal line alone
  await page.mouse.click(box.x + 80 * scale, box.y + 395 * scale);
  await expect(page.locator('.ce-object.selected')).toHaveCount(1);
  const [rect] = await selectedRects(page);
  expect(rect.x).toBeGreaterThan(55);
  expect(rect.w).toBeLessThan(120);
  expect(rect.h).toBeLessThan(20);

  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  let [first, second] = await pageTexts(page);
  expect(first).not.toContain('横書きの行です');
  expect(first).toContain('縦書きの見本');
  expect(second).toContain('横書きの行です');

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  [first] = await pageTexts(page);
  expect(first).toContain('横書きの行です');

  // Redo, then the saved file keeps the deletion on page 1 only
  await page.locator('.toolbar button', { hasText: 'やり直す' }).click();
  await page.waitForTimeout(400);
  await saveAndReopen(page);
  [first, second] = await pageTexts(page);
  expect(first).not.toContain('横書きの行です');
  expect(first).toContain('縦書きの見本');
  expect(second).toContain('横書きの行です');
});

test('Form の中の文字を移動すると、移動先に書き直して書体を帯に示す', async ({ page }) => {
  await startContentEdit(page);
  const { box, scale } = await pageGeometry(page);
  await page.mouse.click(box.x + 80 * scale, box.y + 395 * scale);
  await page.mouse.move(box.x + 80 * scale, box.y + 395 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 * scale, box.y + 495 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  // The banner names the typeface the text was written in (BIZ UDP Gothic in the sample: no PC font in tests)
  await expect(page.locator('.content-edit-banner')).toContainText('書き直しました');

  const lineTop = async () => {
    const rects: { content: string; rect: { origin: { y: number } } }[] = await page.evaluate(async () => {
      const rt = window.__pdf.runtime;
      const doc = window.__pdf.docs.getActiveDocument();
      return rt.engine.getPageTextRects(doc, doc.pages[0]).toPromise();
    });
    return rects.filter((r) => r.content.includes('横書き')).map((r) => r.rect.origin.y);
  };
  // Baseline 400 → 500: the line now sits about 100pt lower, and only once
  let tops = await lineTop();
  expect(tops).toHaveLength(1);
  expect(tops[0]).toBeGreaterThan(480);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  tops = await lineTop();
  expect(tops).toHaveLength(1);
  expect(tops[0]).toBeLessThan(400);
});

test('Form の中の縦書きの列を置換すると縦書きのまま書き換わる', async ({ page }) => {
  await startContentEdit(page);
  await replaceAt(page, [500, 150], '縦書きの見本です。「テスト」用ー', '置き換えた縦書き');

  const bytes = await saveAndReopen(page);
  // The new column uses our embedded font in vertical writing mode
  const fontDicts = bytes.toString('latin1').match(/<<[^<>]*\/Identity-V[^<>]*>>/g) ?? [];
  expect(fontDicts.some((d) => d.includes('PDFEDT+'))).toBe(true);
  const [first, second] = await pageTexts(page);
  expect(first).toContain('置き換えた縦書き');
  expect(first).not.toContain('縦書きの見本');
  expect(first).toContain('横書きの行です');
  expect(second).toContain('縦書きの見本');

  // In the place of the original column 1
  const rects: { content: string; rect: { origin: { x: number; y: number }; size: { width: number } } }[] =
    await page.evaluate(async () => {
      const rt = window.__pdf.runtime;
      const doc = window.__pdf.docs.getActiveDocument();
      return rt.engine.getPageTextRects(doc, doc.pages[0]).toPromise();
    });
  const replaced = rects.filter((r) => /[置換えた縦書]/.test(r.content) && r.rect.origin.x > 490);
  expect(replaced.length).toBeGreaterThan(0);
  for (const r of replaced) {
    expect(r.rect.origin.x + r.rect.size.width).toBeLessThan(510);
    expect(r.rect.origin.y).toBeGreaterThan(95);
  }
});
