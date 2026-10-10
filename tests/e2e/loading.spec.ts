import { test, expect } from '@playwright/test';
import { sample, waitUntilOpened } from './helpers';

test('開いている間は読み込み中の表示が段階を追って出て、開き終わると消える', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  // Record every step the overlay shows (each step is painted before the work behind it starts)
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __steps: string[] }).__steps = seen;
    new MutationObserver(() => {
      const step = document.querySelector('.loading-step')?.textContent?.trim();
      if (step && seen[seen.length - 1] !== step) seen.push(step);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator('input[type=file]').first().setInputFiles(sample('sample-ja-form.pdf'));
  await waitUntilOpened(page);
  const steps = await page.evaluate(() => (window as unknown as { __steps: string[] }).__steps);
  expect(steps).toEqual(['1 / 5', '2 / 5', '3 / 5', '4 / 5', '5 / 5']);
});

test('読み込み中の表示にファイル名と大きさが出る', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.evaluate(() => {
    new MutationObserver((_, observer) => {
      const card = document.querySelector('.loading-card');
      if (!card) return;
      (window as unknown as { __card: string }).__card = card.textContent ?? '';
      observer.disconnect();
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.locator('input[type=file]').first().setInputFiles(sample('sample-ja-form.pdf'));
  await waitUntilOpened(page);
  const card = await page.evaluate(() => (window as unknown as { __card: string }).__card);
  expect(card).toContain('sample-ja-form.pdf');
  expect(card).toMatch(/\d+ KB/);
});
