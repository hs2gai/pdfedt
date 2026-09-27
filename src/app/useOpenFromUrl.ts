import { useEffect, useRef, useState } from 'react';
import { fileNameFor, looksLikePdf, sourceUrlOf } from './source-url';
import { t } from '../i18n';

/**
 * On startup and on hashchange, look at #src=<URL> and fetch and open that PDF (Chrome extension build only).
 * The web build forbids external fetches with connect-src 'self', so this path is disabled there entirely (P1: zero network traffic).
 */
export function useOpenFromUrl(
  ready: boolean,
  open: (file: File, sourceKey: string) => Promise<void>,
  onStatus: (s: string) => void,
) {
  const opened = useRef<string | null>(null);
  // On a page opened from a URL, never auto-resume the last session (for the whole lifetime of the page, even after opening)
  const [fromUrl] = useState(() => __EXTENSION__ && sourceUrlOf(location.hash) !== null);
  useEffect(() => {
    if (!__EXTENSION__ || !ready) return;
    const run = async () => {
      const src = sourceUrlOf(location.hash);
      if (!src || opened.current === src) return;
      opened.current = src;
      onStatus(t('url.loading', { url: src }));
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!looksLikePdf(bytes)) throw new Error(t('url.notPdf'));
        const file = new File([bytes], fileNameFor(src, res.headers.get('content-disposition')), {
          type: 'application/pdf',
        });
        await open(file, `url|${src}`);
        onStatus('');
        // Remove it from the URL once opened, so a reload does not refetch and overwrite the in-progress work
        history.replaceState(null, '', location.pathname);
      } catch (e) {
        onStatus(t('url.fetchFailed', { message: (e as Error).message }));
      }
    };
    void run();
    window.addEventListener('hashchange', run);
    return () => window.removeEventListener('hashchange', run);
  }, [ready, open, onStatus]);
  return fromUrl;
}
