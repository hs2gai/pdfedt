import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

// Resolve samples/ from the package.json directory as the root (__dirname is unavailable in ESM)
const samplesDir = resolve(process.cwd(), 'samples');
export const sample = (name: string) => resolve(samplesDir, name);

/** Opens the app, loads a PDF and waits until the first page is rendered */
export async function openPdf(page: Page, file: string) {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').first().setInputFiles(sample(file));
  await waitUntilOpened(page);
  await page.waitForTimeout(300);
}

/** Waits until the first page is drawn and the loading overlay (which keeps input out) is gone */
export async function waitUntilOpened(page: Page) {
  await page.waitForSelector('.page img');
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
}

/** Opens bytes through the file input, as a picked file. Waiting is left to the caller (a password prompt may come first) */
export async function openBytes(page: Page, bytes: Buffer, name = 'saved.pdf') {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
}

/** Opens bytes in place of the document and waits until the first page is rendered */
export async function reopen(page: Page, bytes: Buffer, settle = 800) {
  await openBytes(page, bytes);
  await waitUntilOpened(page);
  await page.waitForTimeout(settle);
}

/** Leaves content editing mode and opens the exported bytes in place of the document */
export async function reopenAfterContentEdit(page: Page, bytes: Buffer) {
  await page.locator('.toolbar button', { hasText: '本文編集を終了' }).click();
  await reopen(page, bytes, 500);
}

/** Drags on the first page between two points given in pt (top-left origin) */
export async function dragPt(page: Page, from: [number, number], to: [number, number], settle = 300) {
  const { box, scale } = await pageGeometry(page);
  await page.mouse.move(box.x + from[0] * scale, box.y + from[1] * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * scale, box.y + to[1] * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(settle);
}

/** On-screen rect of the first page and the pt -> px scale */
export async function pageGeometry(page: Page) {
  const box = await page.locator('.page').first().boundingBox();
  expect(box).not.toBeNull();
  const pdfWidth = await page.evaluate(() => {
    const d = window.__pdf.docs.getActiveDocument();
    return d.pages[0].size.width as number;
  });
  return { box: box!, scale: box!.width / pdfWidth };
}

/**
 * Selects a toolbar tool. A tool in a group (marker / shape) that is not currently shown
 * is picked from the ▾ menu
 */
export async function selectTool(page: Page, label: string) {
  const direct = page.locator(`.toolbar .icon-btn[aria-label="${label}"]`);
  if ((await direct.count()) > 0) return direct.first().click();
  for (const caret of await page.locator('.toolbar .group-caret').all()) {
    await caret.click();
    const item = page.locator(`.tool-menu button[aria-label="${label}"]`);
    if ((await item.count()) > 0) return item.click();
    await caret.click();
  }
  throw new Error(`ツールが見つかりません: ${label}`);
}

/** Places text at the click position with the Text tool */
export async function addText(page: Page, x: number, y: number, text: string) {
  await page.locator('.toolbar button', { hasText: 'テキスト' }).first().click();
  await page.mouse.click(x, y);
  await page.waitForSelector('.popover textarea');
  await page.fill('.popover textarea', text);
  await page.locator('.popover button', { hasText: '確定' }).click();
  await page.waitForTimeout(800);
}

export async function annotationTypes(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    window.__pdf.annotations.getAnnotations().map((a: { object: { type: number } }) => a.object.type),
  );
}

/** Exports from the save menu and returns the downloaded bytes */
export async function saveVia(page: Page, label: string): Promise<Buffer> {
  return (await saveDownload(page, label)).bytes;
}

/** Exports from the save menu; the downloaded bytes with the suggested file name */
export async function saveDownload(page: Page, label: string) {
  await page.locator('.toolbar .save-btn').click();
  return downloadBytes(
    page,
    // Match by the label (descriptions may mention other save names: save.incrementalBlocked)
    () => page.locator('.menu-list button', { has: page.locator('.menu-label', { hasText: label }) }).click(),
  );
}

/** Waits for the download that `trigger` starts */
export async function downloadBytes(page: Page, trigger: () => Promise<unknown>) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return { bytes: readFileSync(path!), filename: download.suggestedFilename() };
}

/** Saves as a new file in content editing mode and opens the result in place of the document */
export async function saveAndReopen(page: Page): Promise<Buffer> {
  const bytes = await saveVia(page, '新ファイルで保存');
  await reopenAfterContentEdit(page, bytes);
  return bytes;
}

/** Every stream in a PDF with its dictionary (inflated when Flate-compressed). Direct /Length only, as PDFium writes */
export function pdfStreams(bytes: Buffer): { dict: string; data: Buffer }[] {
  const pdf = bytes.toString('latin1');
  const out: { dict: string; data: Buffer }[] = [];
  for (const m of pdf.matchAll(/\d+\s+\d+\s+obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g)) {
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(m[1]);
    if (!length) continue;
    const data = bytes.subarray(m.index! + m[0].length, m.index! + m[0].length + Number(length[1]));
    // Only plain Flate is decoded; other filters and chains (e.g. reportlab's ASCII85 + Flate) are returned as stored
    const flate = /\/Filter\s*(\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(m[1]);
    out.push({ dict: m[1], data: flate ? inflateSync(data) : Buffer.from(data) });
  }
  return out;
}

declare global {
  interface Window {
    /** Test hook exposed in the E2E build (src/app/EditorShell.tsx) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __pdf: any;
  }
}
