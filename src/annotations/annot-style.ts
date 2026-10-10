/**
 * Colors and stroke widths that the user can pick for annotations.
 * Pure data and helpers (no PDFium); the UI lives in StyleControls.tsx.
 */

export interface PaletteColor {
  /** i18n key suffix: color.<id> */
  id: string;
  hex: string;
}

/** Lines, shapes and text. Red / yellow keep embedpdf's defaults so existing tool defaults show as selected */
export const INK_COLORS: PaletteColor[] = [
  { id: 'black', hex: '#000000' },
  { id: 'gray', hex: '#5F6368' },
  { id: 'red', hex: '#E44234' },
  { id: 'orange', hex: '#E8710A' },
  { id: 'yellow', hex: '#F9AB00' },
  { id: 'green', hex: '#1E8E3E' },
  { id: 'blue', hex: '#1A73E8' },
  { id: 'cyan', hex: '#12A4C1' },
  { id: 'purple', hex: '#9334E6' },
  { id: 'brown', hex: '#8D6E63' },
];

/** Highlighter: light colors so the text underneath stays readable (drawn with Multiply) */
export const HIGHLIGHT_COLORS: PaletteColor[] = [
  { id: 'yellow', hex: '#FFCD45' },
  { id: 'green', hex: '#A8E6A1' },
  { id: 'cyan', hex: '#9DDFF5' },
  { id: 'pink', hex: '#F8B4D9' },
  { id: 'orange', hex: '#FFC58A' },
];

/** pt */
export const STROKE_WIDTHS = [0.5, 1, 1.5, 2, 3, 6];

export interface StyleSpec {
  palette: PaletteColor[];
  /** Whether the stroke width can be changed (text markup width follows the text height) */
  width: boolean;
  /** `color` is the fill for shapes / lines, but a deprecated alias of strokeColor for ink and text markup */
  colorIsStroke: boolean;
}

const SHAPE: StyleSpec = { palette: INK_COLORS, width: true, colorIsStroke: false };
const MARKUP: StyleSpec = { palette: INK_COLORS, width: false, colorIsStroke: true };

/** embedpdf tool id → what can be styled. Tools not listed (stamps, notes, our text) have no style controls here */
const SPECS: Record<string, StyleSpec> = {
  ink: { ...SHAPE, colorIsStroke: true },
  square: SHAPE,
  circle: SHAPE,
  line: SHAPE,
  lineArrow: SHAPE,
  underline: MARKUP,
  strikeout: MARKUP,
  highlight: { palette: HIGHLIGHT_COLORS, width: false, colorIsStroke: true },
};

export const STYLED_TOOL_IDS = Object.keys(SPECS);

export const styleSpec = (toolId: string | undefined): StyleSpec | undefined => (toolId ? SPECS[toolId] : undefined);

export interface AnnotStyle {
  color?: string;
  strokeWidth?: number;
}

/** Annotation / tool-default patch for a style. Unknown tools and disallowed fields yield nothing */
export function stylePatch(
  toolId: string,
  style: AnnotStyle,
): { strokeColor?: string; color?: string; strokeWidth?: number } {
  const spec = styleSpec(toolId);
  if (!spec) return {};
  const patch: { strokeColor?: string; color?: string; strokeWidth?: number } = {};
  if (style.color) {
    patch.strokeColor = style.color;
    if (spec.colorIsStroke) patch.color = style.color;
  }
  if (spec.width && style.strokeWidth !== undefined) patch.strokeWidth = style.strokeWidth;
  return patch;
}

export type RGB = { r: number; g: number; b: number };

export const rgbToHex = ({ r, g, b }: RGB): string =>
  '#' +
  [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Palette entry with the same color (case-insensitive), if any */
export const findColor = (palette: PaletteColor[], hex: string | undefined): PaletteColor | undefined =>
  hex ? palette.find((c) => c.hex.toLowerCase() === hex.toLowerCase()) : undefined;
