/**
 * Diagnostic logging for behaviour that is hard to see from outside (selection on real-world PDFs, …).
 * Off by default; enable in the browser console with `localStorage.setItem('pdfedt.debug', '1')` and reload
 */
let enabled: boolean | undefined;
export function debugEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = localStorage.getItem('pdfedt.debug') === '1';
    } catch {
      // Storage blocked (private mode, sandboxed extension page): logging stays off
      enabled = false;
    }
  }
  return enabled;
}

/** Objects are written as JSON, so the whole line can be copied from the console as plain text */
export function debugLog(topic: string, ...data: unknown[]): void {
  if (!debugEnabled()) return;
  console.log([`[pdfedt:${topic}]`, ...data.map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))].join(' '));
}
