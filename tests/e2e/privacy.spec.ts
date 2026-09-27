import { test, expect } from '@playwright/test';
import { openPdf, pageGeometry, addText } from './helpers';

/** P1: works with zero external requests under a strict CSP */
test('外部オリジンへのリクエストが一切ない', async ({ page, baseURL }) => {
  const origins = new Set<string>();
  const cspViolations: string[] = [];
  page.on('request', (r) => origins.add(new URL(r.url()).origin));
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) cspViolations.push(m.text());
  });

  await openPdf(page, 'sample-ja-form.pdf');
  const { box } = await pageGeometry(page);
  // Go as far as an operation that actually loads fonts and WASM
  await addText(page, box.x + 320, box.y + 395, '通信確認');

  expect([...origins]).toEqual([new URL(baseURL!).origin]);
  expect(cspViolations).toEqual([]);
});

test('CSP と分離ヘッダーが配信される', async ({ request, baseURL }) => {
  const res = await request.get(baseURL!);
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self'");
  // Scripts only from same-origin files (no inline). Inline styles are allowed
  expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
});
