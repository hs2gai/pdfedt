import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const { version: appVersion } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// 開発専用: スパイクで生成した PDF を _spike-out/ に保存する（ブラウザのダウンロードを経由せず検証するため）
function spikeSink() {
  return {
    name: 'spike-sink',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use(path: string, h: (req: any, res: any) => void): void } }) {
      const dir = join(process.cwd(), '_spike-out');
      mkdirSync(dir, { recursive: true });
      server.middlewares.use('/__spike/save', (req, res) => {
        const name = decodeURIComponent(
          new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? 'out.pdf',
        ).replace(/[^\w.-]/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          writeFileSync(join(dir, name), Buffer.concat(chunks));
          res.end(JSON.stringify({ saved: name, bytes: Buffer.concat(chunks).length }));
        });
      });
    },
  };
}

// Chrome 拡張ビルド（--mode extension）: manifest.json を生成し、Web 配信専用の _headers を外す。
// background.ts は rollup の別エントリとして固定名 background.js に出す（manifest が参照する）
function extensionFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'extension-files',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle() {
      const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf-8')) as { version: string };
      manifest.version = appVersion;
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
    closeBundle() {
      rmSync(join(outDir, '_headers'), { force: true });
    },
  };
}

// 本番と同じ CSP（public/_headers と一致させる）。
// dev サーバーでは Vite/React Refresh がインライン script を注入するため script-src のみ緩める。
const strictScriptSrc = "script-src 'self' 'wasm-unsafe-eval'";
const devScriptSrc = "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'";
const csp = (scriptSrc: string) =>
  `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`;

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ mode }) => {
  const extension = mode === 'extension';
  return {
    define: { __APP_VERSION__: JSON.stringify(appVersion), __EXTENSION__: extension },
    build: extension
      ? {
          outDir: 'dist-ext',
          rollupOptions: {
            input: { main: 'index.html', background: 'extension/background.ts' },
            output: { entryFileNames: (c) => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
          },
        }
      : undefined,
    plugins: [
      react(),
      spikeSink(),
      extension && extensionFiles(),
      // オフライン動作: WASM・フォント・アプリ本体を事前キャッシュする。
      // ネットワークに依存しないこと自体が「送信していない」ことの証明にもなる。
      // 拡張はパッケージ自体がローカルにあるので Service Worker は使わない
      !extension &&
        VitePWA({
          registerType: 'autoUpdate',
          // CSP でインライン script を禁止しているため、登録スクリプトは外部ファイルで読み込む
          injectRegister: 'script-defer',
          includeAssets: ['icon-192.png', 'icon-512.png', 'fonts/*'],
          manifest: {
            name: 'pdfedt',
            short_name: 'pdfedt',
            description: 'PDF をどこにも送らずに、ブラウザの中だけで注釈を付けて保存します。',
            lang: 'ja',
            theme_color: '#1a73e8',
            background_color: '#ffffff',
            display: 'standalone',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,wasm,ttf,png}'],
            // 追加書体（明朝・毛筆など、計 30MB）は事前キャッシュせず、使われたときに取得して保持する
            globIgnores: ['fonts/!(BIZUDPGothic)*.ttf'],
            maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
            runtimeCaching: [
              {
                urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'),
                handler: 'CacheFirst',
                options: { cacheName: 'fonts', expiration: { maxEntries: 10 } },
              },
            ],
          },
        }),
    ],
    server: { headers: { 'Content-Security-Policy': csp(devScriptSrc), ...isolationHeaders } },
    preview: { headers: { 'Content-Security-Policy': csp(strictScriptSrc), ...isolationHeaders } },
  };
});
