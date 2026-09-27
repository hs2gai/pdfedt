import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { sample } from './helpers';

/**
 * Chrome 拡張（dist-ext/。`pnpm build:ext` で生成）。
 * ブラウザで開いた PDF が pdfedt のビューワページに付け替えられ、内容が表示されること。
 * 拡張は永続コンテキストでしか読み込めないため、既定の page フィクスチャは使わない。
 * 未パッケージの拡張は「ファイルの URL へのアクセスを許可する」が既定でオンなので、file:// の経路もここで通る。
 */
const extDir = resolve(process.cwd(), 'dist-ext');
test.skip(!existsSync(resolve(extDir, 'manifest.json')), 'dist-ext/ が無い（pnpm build:ext を先に実行）');

let server: Server;
let origin: string;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
/** サーバーが受けた要求のパス */
const hits: string[] = [];

test.beforeAll(async () => {
  // .pdf で終わる URL と、Content-Type でしか PDF と分からない URL の両方を配る
  const pdf = readFileSync(sample('sample-ja-form.pdf'));
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    hits.push(path);
    if (path === '/doc.pdf' || path === '/download') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.byteLength });
      res.end(pdf);
    } else if (path === '/page.html' || path === '/fake.pdf') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>not a pdf</title>');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  // onInstalled で動的ルールが入るまで待つ
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length)))
    .toBe(1);
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const viewer = (src: string) => `chrome-extension://${extensionId}/index.html#src=${src}`;

test('.pdf で終わる URL は要求の時点でビューワに転送され、内容が表示される', async () => {
  const page = await context.newPage();
  hits.length = 0;
  await page.goto(`${origin}/doc.pdf`);
  expect(page.url()).toBe(viewer(`${origin}/doc.pdf`));
  await page.waitForSelector('.page img');
  await expect(page.locator('.doc-name')).toHaveText('doc.pdf');
  // 開けたら #src= は外れる（再読み込みで作業中の内容を取り直さない）
  await expect.poll(() => page.url()).toBe(`chrome-extension://${extensionId}/index.html`);
  // 要求の時点で転送されるので、サーバーに届くのはビューワからの 1 回だけ（内蔵ビューワ向けの読み込みは起きない）
  expect(hits.filter((p) => p === '/doc.pdf')).toHaveLength(1);
  await page.close();
});

test('Content-Type が PDF の URL はヘッダー受信後にビューワへ差し替わる', async () => {
  const page = await context.newPage();
  // 差し替えで元のナビゲーションが中断されることがあるので、goto の失敗は無視して URL の変化を待つ
  await page.goto(`${origin}/download?id=1`).catch(() => {});
  await page.waitForURL(viewer(`${origin}/download?id=1`));
  await page.waitForSelector('.page img');
  await expect(page.locator('.doc-name')).toHaveText('download.pdf');
  await page.close();
});

test('file:// のローカル PDF もビューワへ差し替わる（未パッケージの拡張はファイル URL へのアクセスが既定で許可）', async () => {
  const page = await context.newPage();
  const url = pathToFileURL(sample('sample-ja-form.pdf')).href;
  // 差し替えで元のナビゲーションが中断される（ERR_ABORTED）ので、goto の失敗は無視して URL の変化を待つ
  await page.goto(url).catch(() => {});
  await page.waitForSelector('.page img');
  await expect(page.locator('.doc-name')).toHaveText('sample-ja-form.pdf');
  expect(page.url()).toBe(`chrome-extension://${extensionId}/index.html`);
  await page.close();
});

test('PDF でないページは触らない', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/page.html`);
  await expect(page).toHaveTitle('not a pdf');
  expect(page.url()).toBe(`${origin}/page.html`);
  await page.close();
});

test('.pdf で終わるが中身が PDF でない URL は、転送後にエラーを表示して開かない', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/fake.pdf`);
  expect(page.url()).toBe(viewer(`${origin}/fake.pdf`));
  await expect(page.locator('.status-bar')).toContainText('PDFではありません');
  await expect(page.locator('.page img')).toHaveCount(0);
  await page.close();
});

test('他のサイトからビューワを iframe で埋め込むことはできない（拡張の権限で任意の URL を読ませない）', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/page.html`);
  hits.length = 0;
  // 拡張 ID が知られていても、埋め込み自体が frame-ancestors で拒否される
  await page.evaluate(
    (src) =>
      new Promise<void>((done) => {
        const f = document.createElement('iframe');
        f.onload = () => done();
        f.src = src;
        document.body.append(f);
      }),
    viewer(`${origin}/doc.pdf`),
  );
  // 拒否された iframe はエラーページになる（許可されていると onload の後でビューワが doc.pdf を取りに行く）
  const frame = page.frames().find((f) => f !== page.mainFrame());
  expect(frame?.url()).toMatch(/^chrome-error:/);
  expect(hits).not.toContain('/doc.pdf');
  await page.close();
});
