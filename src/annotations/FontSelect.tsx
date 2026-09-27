import type { ReactNode } from 'react';
import { FONTS, fontLabel, type FontId } from '../pdf/fonts/catalog';
import { isLocalFontId, japaneseLocalFonts, localFontById, localFontId } from '../pdf/fonts/local-fonts';
import { useAppSettings } from '../app/settings';
import { useT } from '../i18n';

interface Props {
  value: FontId;
  onChange: (id: FontId) => void;
  /** Extra options placed first (e.g. "same as original" in content editing) */
  children?: ReactNode;
}

/**
 * Font picker. Besides the 5 bundled typefaces, when the "Use fonts installed on this PC" setting is on,
 * Japanese-capable fonts installed on the PC are listed too (ID is `local:<PostScript name>`).
 * Fonts missing on this PC (e.g. a stamp made on another PC) are shown as a disabled option.
 */
export function FontSelect({ value, onChange, children }: Props) {
  const { localFonts } = useAppSettings();
  const t = useT();
  const locals = localFonts ? japaneseLocalFonts() : [];
  const missing = isLocalFontId(value) && !localFontById(value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as FontId)}>
      {children}
      {FONTS.map((f) => (
        <option key={f.id} value={f.id}>
          {fontLabel(f.id)}
        </option>
      ))}
      {locals.length > 0 && (
        <optgroup label={t('font.localGroup')}>
          {locals.map((f) => (
            <option key={f.postscriptName} value={localFontId(f)}>
              {f.fullName}
            </option>
          ))}
        </optgroup>
      )}
      {missing && (
        <option value={value} disabled>
          {fontLabel(value)}
        </option>
      )}
    </select>
  );
}
