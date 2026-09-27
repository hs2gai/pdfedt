import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// package.json のある場所をルートとして samples/ を参照する（ESM のため __dirname は使えない）
export const samplesDir = resolve(process.cwd(), 'samples');
export const sample = (name: string) => resolve(samplesDir, name);

/** アプリを開いて PDF を読み込み、1 ページ目が描画されるまで待つ */
export async function openPdf(page: Page, file: string) {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').first().setInputFiles(sample(file));
  await page.waitForSelector('.page img');
  await page.waitForTimeout(300);
}

/** 1 ページ目の画面上の矩形と、pt → px の倍率 */
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
 * ツールバーのツールを選ぶ。グループ（マーカー / 図形）にまとめられたツールは、
 * 表示中でなければ ▾ のメニューから選ぶ
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

/** テキストツールでクリック位置に文字を置く */
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

/** 保存メニューから書き出し、ダウンロードされたバイト列を返す */
export async function saveVia(page: Page, label: string): Promise<Buffer> {
  await page.locator('.toolbar .save-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    // 見出しで探す（説明文に他の保存の名前が出ることがある: save.incrementalBlocked）
    page.locator('.menu-list button', { has: page.locator('.menu-label', { hasText: label }) }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFileSync(path!);
}

declare global {
  interface Window {
    /** E2E 用ビルドで公開される検証フック（src/app/EditorShell.tsx） */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __pdf: any;
  }
}
