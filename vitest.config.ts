import { defineConfig } from 'vitest/config';

// Unit tests for pure logic (date formatting, font parsing, xref rewriting, etc.).
// Anything that goes through PDFium is covered by tests/e2e (Playwright)
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
