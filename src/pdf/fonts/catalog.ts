/**
 * List of bundled fonts (all SIL OFL; license texts are bundled in public/fonts/).
 * Served from the same origin, subset to the characters used and embedded in the PDF.
 * Fonts other than gothic are fetched on first selection (cached at runtime by the PWA).
 */
import { isLocalFontId, localFontById } from './local-fonts';
import { t } from '../../i18n';

export type BundledFontId = 'gothic' | 'mincho' | 'shippori' | 'yuji' | 'zen';
/** A bundled typeface, or a PC font (`local:<PostScript name>`; selectable only when enabled in settings) */
export type FontId = BundledFontId | `local:${string}`;

export interface FontInfo {
  id: BundledFontId;
  file: string;
}

/** Labels come from i18n: font.<id> */
export const FONTS: FontInfo[] = [
  { id: 'gothic', file: 'BIZUDPGothic-Regular.ttf' },
  { id: 'mincho', file: 'BIZUDPMincho-Regular.ttf' },
  { id: 'shippori', file: 'ShipporiMincho-Regular.ttf' },
  { id: 'yuji', file: 'YujiSyuku-Regular.ttf' },
  { id: 'zen', file: 'ZenAntique-Regular.ttf' },
];

export const DEFAULT_FONT_ID: BundledFontId = 'gothic';

export const bundledFontInfo = (id: BundledFontId): FontInfo => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Display name of a typeface (current language). PC fonts use their own name; fonts missing on this PC say so */
export function fontLabel(id: FontId | undefined): string {
  if (id && isLocalFontId(id)) {
    const f = localFontById(id);
    return f ? t('font.local', { name: f.fullName }) : t('font.localMissing', { name: id.slice('local:'.length) });
  }
  return t(`font.${FONTS.some((f) => f.id === id) ? (id as BundledFontId) : DEFAULT_FONT_ID}`);
}
