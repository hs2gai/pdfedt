import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve samples/ from the package.json directory as the root (__dirname is unavailable in ESM)
export const samplesDir = resolve(process.cwd(), 'samples');
export const sample = (name: string) => resolve(samplesDir, name);

/** Opens the app, loads a PDF and waits until the first page is rendered */
export async function openPdf(page: Page, file: string) {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').first().setInputFiles(sample(file));
  await page.waitForSelector('.page img');
  await page.waitForTimeout(300);
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
  await page.locator('.toolbar .save-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    // Match by the label (descriptions may mention other save names: save.incrementalBlocked)
    page.locator('.menu-list button', { has: page.locator('.menu-label', { hasText: label }) }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFileSync(path!);
}

declare global {
  interface Window {
    /** Test hook exposed in the E2E build (src/app/EditorShell.tsx) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __pdf: any;
  }
}
