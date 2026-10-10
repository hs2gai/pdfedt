/**
 * Resolves after the browser has painted. PDFium runs on the main thread, so call this before a long synchronous
 * step to get a status change (e.g. the loading overlay) on screen first
 */
export const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Resolves once `done()` holds, checked every frame, or after `timeoutMs` at the latest */
export function whenReady(done: () => boolean, timeoutMs: number): Promise<void> {
  const until = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => (done() || performance.now() > until ? resolve() : requestAnimationFrame(check));
    check();
  });
}
