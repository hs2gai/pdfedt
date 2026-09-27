import { defineConfig } from '@playwright/test';

// 本番相当（厳格な CSP 付きの vite preview）に対して E2E を走らせる。
// `VITE_E2E=1` で window.__pdf（検証用フック）が有効になる。
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1400, height: 1800 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'pnpm build:e2e && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
