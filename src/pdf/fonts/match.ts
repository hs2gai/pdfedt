import type { BundledFontId } from './catalog';

/** fpdf_edit.h: Serif bit of FPDFFont_GetFlags */
const FONT_FLAG_SERIF = 1 << 1;

/** Font name fragments regarded as mincho (compared in lower case) */
const MINCHO_HINTS = [
  'mincho',
  'ming',
  'song',
  'serif',
  'roman',
  'times',
  'georgia',
  'garamond',
  'century',
  'book',
  'hiramin',
  'ryumin',
  'kozmin',
  'haranoajimincho',
  'sourcehanserif',
  'notoserif',
  '明朝',
];
/** Gothic (sans-serif) fonts whose names contain "serif" */
const SANS_HINTS = ['sans', 'gothic', 'ゴシック', 'yahei', 'meiryo', 'kaku', 'maru', 'mono'];

/**
 * Guesses the bundled typeface to use as a replacement from the original font name.
 * The goal is not exact reproduction but keeping "mincho as mincho, gothic as gothic".
 */
export function guessFontId(fontName: string, flags = 0): BundledFontId {
  const name = fontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  if (SANS_HINTS.some((h) => name.includes(h))) return 'gothic';
  if (MINCHO_HINTS.some((h) => name.includes(h))) return 'mincho';
  if (flags & FONT_FLAG_SERIF) return 'mincho';
  return 'gothic';
}

/**
 * Whether the font is bold. The name takes priority (PDFium's weight is estimated from StemV and can be unreliable);
 * weight is consulted only when the name gives no hint.
 */
export function isBoldFont(fontName: string, weight = 400): boolean {
  const name = fontName.replace(/^[A-Z]{6}\+/, '');
  if (/regular|light|thin|medium|normal|-[RLM]$/i.test(name)) return false;
  if (/bold|black|heavy|semibold|\bW[6-9]\b|-[BHE]$/i.test(name)) return true;
  return weight >= 700;
}
