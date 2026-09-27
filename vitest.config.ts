import { defineConfig } from 'vitest/config';

// 純粋ロジック（日付書式・フォント解析・xref の書き直し など）のユニットテスト。
// PDFium を通す部分は tests/e2e（Playwright）で確認する
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
