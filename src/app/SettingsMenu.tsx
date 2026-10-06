import { useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '../annotations/Toolbar';
import { appSettings, useAppSettings, type Locale } from './settings';
import { loadLocalFontCatalog, supportsLocalFonts } from '../pdf/fonts/local-fonts';
import { useDismiss } from '../shared/useDismiss';
import { LOCALES, useT } from '../i18n';

/** Settings menu at the right end of the toolbar */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const s = useAppSettings();
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  // When the toolbar wraps and the button sits on the left, right-anchoring would overflow the screen, so anchor to the left instead
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    el.style.right = '';
    el.style.left = '';
    if (el.getBoundingClientRect().left < 0) {
      el.style.right = 'auto';
      el.style.left = '0';
    }
  }, [open]);

  // Fetch the list inside the click handler (the first permission dialog needs a user gesture)
  const toggleLocalFonts = async (on: boolean) => {
    setFontError(null);
    if (!on) return appSettings.set({ localFonts: false });
    try {
      await loadLocalFontCatalog();
      appSettings.set({ localFonts: true });
    } catch (e) {
      setFontError(e instanceof Error && e.name === 'NotAllowedError' ? t('settings.localFonts.denied') : String(e));
    }
  };
  return (
    <div ref={root} className="menu">
      <IconButton icon="settings" label={t('settings.title')} title={t('settings.help')} active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div ref={list} className="menu-list settings-list" onMouseLeave={() => setOpen(false)}>
          <label className="settings-row settings-select">
            <span className="menu-label">{t('settings.language')}</span>
            <select value={s.locale} onChange={(e) => appSettings.set({ locale: e.target.value as Locale })}>
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <input type="checkbox" checked={s.autoResume} onChange={(e) => appSettings.set({ autoResume: e.target.checked })} />
            <span>
              <span className="menu-label">{t('settings.autoResume')}</span>
              <span className="menu-help">{t('settings.autoResume.help')}</span>
            </span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={s.smoothScroll}
              onChange={(e) => appSettings.set({ smoothScroll: e.target.checked })}
            />
            <span>
              <span className="menu-label">{t('settings.smoothScroll')}</span>
              <span className="menu-help">{t('settings.smoothScroll.help')}</span>
            </span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={s.highlightFields}
              onChange={(e) => appSettings.set({ highlightFields: e.target.checked })}
            />
            <span>
              <span className="menu-label">{t('settings.highlightFields')}</span>
              <span className="menu-help">{t('settings.highlightFields.help')}</span>
            </span>
          </label>
          {supportsLocalFonts() && (
            <label className="settings-row">
              <input type="checkbox" checked={s.localFonts} onChange={(e) => void toggleLocalFonts(e.target.checked)} />
              <span>
                <span className="menu-label">{t('settings.localFonts')}</span>
                <span className="menu-help">{fontError ?? t('settings.localFonts.help')}</span>
              </span>
            </label>
          )}
          <div className="menu-help settings-version">pdfugu {__APP_VERSION__}</div>
        </div>
      )}
    </div>
  );
}
