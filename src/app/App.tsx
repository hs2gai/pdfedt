import { useEffect, useState } from 'react';
import { createPdfRuntime, type PdfRuntime } from '../pdf/engine';
import { Editor } from './Editor';
import { StampEditor } from '../stamp-editor/StampEditor';
import { appSettings, useAppSettings } from './settings';
import { loadLocalFontCatalog } from '../pdf/fonts/local-fonts';
import { useT } from '../i18n';

/** Switch screens by hash (#/stamps: stamp editor; can be opened in another tab) */
function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const [runtime, setRuntime] = useState<PdfRuntime | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const route = useHashRoute();
  const t = useT();
  const { locale } = useAppSettings();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    createPdfRuntime().then(setRuntime, setError);
    // If the setting is on, reload the PC font list at startup (no dialog when already granted; if revoked, turn the setting off)
    if (appSettings.get().localFonts) {
      loadLocalFontCatalog().catch((e) => {
        console.warn('Could not read the PC font list; disabling the setting', e);
        appSettings.set({ localFonts: false });
      });
    }
  }, []);

  if (error) return <div style={{ padding: 16 }}>{t('app.engineError', { message: error.message })}</div>;
  if (!runtime) return <div style={{ padding: 16 }}>{t('app.engineLoading')}</div>;
  if (route === '#/stamps') return <StampEditor runtime={runtime} />;
  return <Editor runtime={runtime} />;
}
