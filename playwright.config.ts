import { defineConfig } from '@playwright/test';

// Runs E2E against a production-like build (vite preview with the strict CSP).
// `VITE_E2E=1` enables window.__pdf (the test hook).
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
