import { test, expect } from '@playwright/test';
import { openPdf } from './helpers';

/** フォント非埋め込みの和文 PDF が、同梱フォント（明朝系なら明朝）で描画されること（外部通信なし） */
test('非埋め込み和文フォントが同梱フォントで表示される', async ({ page, baseURL }) => {
  const origins = new Set<string>();
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  await openPdf(page, 'sample-noembed.pdf');
  await page.waitForTimeout(800);

  // 見出し行（pt 左上原点 50,50 – 450,100）に黒いピクセルがある = 豆腐でも空白でもない
  const inkRatio = await page.evaluate(async () => {
    const img = document.querySelector('.page img') as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const s = img.naturalWidth / 595.276;
    const d = ctx.getImageData(50 * s, 50 * s, 400 * s, 50 * s).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark / (d.length / 4);
  });
  expect(inkRatio).toBeGreaterThan(0.02);
  expect([...origins]).toEqual([new URL(baseURL!).origin]);

  // HeiseiMin-W3（明朝）は同梱の明朝で描かれ、ゴシックに落ちていない
  const log: { face: string; source: string }[] = await page.evaluate(() => window.__pdf.runtime.fonts.log);
  expect(log.filter((r) => r.face === 'HeiseiMin-W3').map((r) => r.source)).toEqual(['mincho']);
});
