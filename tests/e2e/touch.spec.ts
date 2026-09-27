import { test, expect, devices, type Page } from '@playwright/test';
import { sample } from './helpers';

/** スマホ（タッチ・狭い画面）。マウスの「離れる」が無いので、メニューやパネルは外側のタップで閉じられること */
test.use({ ...devices['Pixel 7'] });

const tap = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.locator('input[type=file]').first().setInputFiles(sample('sample-ja-form.pdf'));
  await page.waitForSelector('.page img');
});

test('狭い画面ではページ一覧を閉じた状態で始まり、パネルは画面幅に収まる', async ({ page }) => {
  await expect(page.locator('.thumbs')).toHaveCount(0);
  await tap(page, '.toolbar .icon-btn[aria-label="スタンプ"]');
  const panel = await page.locator('.stamp-panel').boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('ツールのメニューは外側のタップと別ツールのタップで閉じる', async ({ page }) => {
  await tap(page, '.toolbar .group-caret');
  await expect(page.locator('.tool-menu')).toHaveCount(1);
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width / 2, height - 30);
  await expect(page.locator('.tool-menu')).toHaveCount(0);

  await tap(page, '.toolbar .group-caret');
  await tap(page, '.toolbar .icon-btn[aria-label="スタンプ"]');
  await expect(page.locator('.tool-menu')).toHaveCount(0);
  await expect(page.locator('.stamp-panel')).toHaveCount(1);
});

test('スタンプはページのタップで押され、× で中止できる', async ({ page }) => {
  await tap(page, '.toolbar .icon-btn[aria-label="スタンプ"]');
  await tap(page, '.stamp-panel [aria-label="スタンプを中止"]');
  await expect(page.locator('.stamp-panel')).toHaveCount(0);

  await tap(page, '.toolbar .icon-btn[aria-label="スタンプ"]');
  const panel = await page.locator('.stamp-panel').boundingBox();
  const { width } = page.viewportSize()!;
  await page.touchscreen.tap(width / 2, panel!.y + panel!.height + 60);
  await expect.poll(() => page.evaluate(() => window.__pdf.annotations.getAnnotations().length)).toBe(1);
  await expect(page.locator('.stamp-panel')).toHaveCount(0);
});

test('保存・設定・最近使ったファイルのメニューも外側のタップで閉じる', async ({ page }) => {
  const { width, height } = page.viewportSize()!;
  for (const btn of ['.toolbar .save-btn', '.toolbar .icon-btn[aria-label="設定"]', '.toolbar .recent-btn']) {
    await tap(page, btn);
    await expect(page.locator('.menu-list')).toHaveCount(1);
    await page.touchscreen.tap(width / 2, height - 30);
    await expect(page.locator('.menu-list')).toHaveCount(0);
  }
});

test('タップ後もボタンの色が保たれる（:hover が残って白背景に白文字にならない）', async ({ page }) => {
  await tap(page, '.toolbar .save-btn');
  const style = await page.locator('.toolbar .save-btn').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  // 青（押下中はやや濃い青）のまま。白い hover 背景（#f3f5f8）にはならない
  expect(['rgb(26, 115, 232)', 'rgb(21, 88, 184)']).toContain(style.bg);
  expect(style.color).toBe('rgb(255, 255, 255)');
  // メニューの文字色も明示した色（iOS Safari の既定のアクセント色にならない）
  await expect(page.locator('.menu-list .menu-label').first()).toHaveCSS('color', 'rgb(34, 34, 34)');
});

/** 合成タッチイベント（Chromium は TouchEvent コンストラクタでマルチタッチを作れる） */
const touch = async (page: Page, type: 'touchstart' | 'touchmove' | 'touchend', points: [number, number][]) =>
  page.evaluate(
    ({ type, points }) => {
      const el = document.querySelector('.viewport')!;
      const touches = points.map(
        ([x, y], i) =>
          new Touch({ identifier: i, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y }),
      );
      el.dispatchEvent(
        new TouchEvent(type, { touches: type === 'touchend' ? [] : touches, changedTouches: touches, bubbles: true, cancelable: true }),
      );
    },
    { type, points },
  );

test('二本指のドラッグで表示がスクロールする', async ({ page }) => {
  const before = await page.locator('.viewport').evaluate((el) => el.scrollTop);
  await touch(page, 'touchstart', [[150, 600], [250, 600]]);
  await touch(page, 'touchmove', [[150, 500], [250, 500]]);
  await touch(page, 'touchmove', [[150, 400], [250, 400]]);
  await touch(page, 'touchend', [[150, 400], [250, 400]]);
  await expect.poll(() => page.locator('.viewport').evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 150);
});

test('二本指のピンチで拡大する', async ({ page }) => {
  const zoomOf = () => page.locator('.toolbar .zoom').textContent().then((s) => parseInt(s ?? '0', 10));
  const before = await zoomOf();
  await touch(page, 'touchstart', [[150, 500], [250, 500]]);
  await touch(page, 'touchmove', [[120, 500], [280, 500]]);
  await touch(page, 'touchmove', [[100, 500], [300, 500]]);
  await touch(page, 'touchend', [[100, 500], [300, 500]]);
  await expect.poll(zoomOf).toBeGreaterThan(before * 1.5);
});
