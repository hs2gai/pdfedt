import type { AppearanceSpec, RGB } from '../../pdf/appearance';
import { formatDate, formatDateCompact, formatDateCustom, type DateFormat } from '../../shared/dates';
import { DEFAULT_FONT_ID, type FontId } from '../../pdf/fonts/catalog';
import { uuid } from '../../shared/uuid';
import { t as tr, type MessageKey } from '../../i18n';

/**
 * Stamp template.
 * A fixed-size (pt) frame with shapes and text laid out inside. Coordinates are pt with a top-left origin (same as the screen).
 * Text may use the placeholder syntax `{label}` / `{label:default}`; each label becomes an input field when stamping.
 * Special labels: `{日付}` (stamping date; format chosen when stamping), `{短い日付}` (R8.9.21 style),
 * `{氏名}` `{部署}` (remember the last input)
 */
export interface StampTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Default ink color (id from STAMP_COLORS). Can be changed when stamping */
  color: string;
  elements: StampElement[];
  /** Bundled built-in (read-only; duplicate to edit) */
  builtin?: boolean;
  updatedAt: number;
}

interface ElementBase {
  id: string;
  /** Defaults to the stamp color */
  color?: string;
}
export interface RectElement extends ElementBase {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius (0 = square) */
  radius: number;
  strokeWidth: number;
  fill: boolean;
}
export interface EllipseElement extends ElementBase {
  type: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  strokeWidth: number;
  fill: boolean;
}
export interface LineElement extends ElementBase {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}
export interface TextElement extends ElementBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Maximum font size. Shrunk when the text does not fit the box */
  fontSize: number;
  vertical: boolean;
  align: 'left' | 'center' | 'right';
  /** When the filled-in value is empty, collapse this row (horizontal band) and shrink the stamp */
  collapseIfEmpty?: boolean;
  /** Typeface (defaults to gothic) */
  font?: FontId;
}
export type StampElement = RectElement | EllipseElement | LineElement | TextElement;

/** Ink colors. Labels come from i18n: stamp.color.<id> */
export const STAMP_COLORS: { id: 'red' | 'blue' | 'black'; rgb: RGB }[] = [
  { id: 'red', rgb: { r: 208, g: 32, b: 32 } },
  { id: 'blue', rgb: { r: 24, g: 72, b: 200 } },
  { id: 'black', rgb: { r: 30, g: 30, b: 30 } },
];
const colorRgb = (id: string | undefined): RGB =>
  STAMP_COLORS.find((c) => c.id === id)?.rgb ?? STAMP_COLORS[0].rgb;

/** Display name. Built-ins use i18n (stampTemplate.<id>); custom stamps use their own name */
export const templateName = (t: StampTemplate): string =>
  t.builtin ? tr(`stampTemplate.${t.id}` as MessageKey) : t.name;

/** Data stored in the annotation (for re-editing / regeneration) */
export interface StampData {
  kind: 'stamp';
  template: string;
  name: string;
  values: Record<string, string>;
  color: string;
}

// ---------------------------------------------------------------------------
// Placeholder syntax

const FIELD_RE = /\{([^{}:]+)(?::([^{}]*))?\}/g;

export interface StampField {
  key: string;
  defaultValue: string;
}

/** Dates are formatted when stamping, so they are not input fields */
export const DATE_KEYS = ['日付', '短い日付'];
/** Labels whose last input is remembered */
export const REMEMBERED_KEYS = ['氏名', '部署'];

/** Fill-in values for dates (formatted and fixed when stamping). With a custom pattern, `{日付}` and `{短い日付}` use the same format */
export function dateValues(format: DateFormat, customPattern = ''): Record<string, string> {
  const now = new Date();
  if (format === 'custom') {
    const v = formatDateCustom(now, customPattern);
    return { 日付: v, 短い日付: v };
  }
  return { 日付: formatDate(now, format), 短い日付: formatDateCompact(now, format) };
}

/** Returns the placeholder fields of a template in order of appearance (without duplicates) */
export function templateFields(template: StampTemplate): StampField[] {
  const seen = new Map<string, StampField>();
  for (const el of template.elements) {
    if (el.type !== 'text') continue;
    for (const m of el.text.matchAll(FIELD_RE)) {
      const key = m[1].trim();
      if (!seen.has(key)) seen.set(key, { key, defaultValue: m[2] ?? '' });
    }
  }
  return [...seen.values()];
}

function resolveText(text: string, values: Record<string, string>): string {
  return text.replace(FIELD_RE, (_, key: string, def?: string) => values[key.trim()] ?? def ?? '');
}

/** Strings used in the appearance (for font subsetting) */
export function templateTexts(template: StampTemplate, values: Record<string, string>): string[] {
  return template.elements.flatMap((el) => (el.type === 'text' ? [resolveText(el.text, values)] : []));
}

/** Per typeface, the strings drawn with it (for subsetting) */
export function templateTextsByFont(template: StampTemplate, values: Record<string, string>): Map<FontId, string[]> {
  const out = new Map<FontId, string[]>();
  for (const el of template.elements) {
    if (el.type !== 'text') continue;
    const id = el.font ?? DEFAULT_FONT_ID;
    out.set(id, [...(out.get(id) ?? []), resolveText(el.text, values)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering

export function bboxOf(el: StampElement): { x: number; y: number; w: number; h: number } {
  if (el.type === 'line') {
    return {
      x: Math.min(el.x1, el.x2),
      y: Math.min(el.y1, el.y2),
      w: Math.abs(el.x2 - el.x1),
      h: Math.abs(el.y2 - el.y1),
    };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/**
 * Template with empty rows collapsed. When the text of a collapseIfEmpty element is empty, its band is removed,
 * elements below move up, and elements spanning the band (e.g. the frame) shrink.
 */
export function collapseEmptyRows(template: StampTemplate, values: Record<string, string>): StampTemplate {
  const bands = template.elements
    .filter((el): el is TextElement => el.type === 'text' && !!el.collapseIfEmpty && !resolveText(el.text, values).trim())
    .map((el) => ({ y0: el.y, y1: el.y + el.h }));
  if (bands.length === 0) return template;
  // Shift up by the total length of the bands above y (if inside a band, up to the band's start)
  const mapY = (y: number) => y - bands.reduce((acc, b) => acc + Math.max(0, Math.min(y, b.y1) - b.y0), 0);
  const elements = template.elements.flatMap((el): StampElement[] => {
    if (el.type === 'line') return [{ ...el, y1: mapY(el.y1), y2: mapY(el.y2) }];
    const y = mapY(el.y);
    const h = mapY(el.y + el.h) - y;
    return h > 0 ? [{ ...el, y, h }] : [];
  });
  return { ...template, height: mapY(template.height), elements };
}

/** Decides how to draw the appearance from the template and values. Converts top-left origin → PDF's bottom-left origin */
export function templateAppearanceSpec(
  source: StampTemplate,
  values: Record<string, string>,
  color: string,
  /** typeface id → subset font (must cover every typeface in templateTextsByFont) */
  fonts: Record<string, Uint8Array>,
): AppearanceSpec {
  const template = collapseEmptyRows(source, values);
  const H = template.height;
  const ink = colorRgb(color);
  const rgbOf = (el: StampElement) => (el.color ? colorRgb(el.color) : ink);
  const fontData = fonts[DEFAULT_FONT_ID] ?? Object.values(fonts)[0];
  if (!fontData) throw new Error('font is required');
  return {
    fontData,
    fonts,
    layout: () => ({ width: template.width, height: H }),
    draw: (c) => {
      for (const el of template.elements) {
        const rgb = rgbOf(el);
        switch (el.type) {
          case 'rect': {
            const inset = el.strokeWidth / 2;
            const style = { stroke: rgb, strokeWidth: el.strokeWidth, fill: el.fill ? rgb : undefined };
            const x = el.x + inset;
            const y = H - el.y - el.h + inset;
            const w = el.w - el.strokeWidth;
            const h = el.h - el.strokeWidth;
            if (el.radius > 0) c.roundRect(x, y, w, h, Math.min(el.radius, w / 2, h / 2), style);
            else c.rect(x, y, w, h, style);
            break;
          }
          case 'ellipse': {
            const inset = el.strokeWidth / 2;
            c.ellipse(el.x + el.w / 2, H - el.y - el.h / 2, el.w / 2 - inset, el.h / 2 - inset, {
              stroke: rgb,
              strokeWidth: el.strokeWidth,
              fill: el.fill ? rgb : undefined,
            });
            break;
          }
          case 'line':
            c.line(el.x1, H - el.y1, el.x2, H - el.y2, el.strokeWidth, rgb);
            break;
          case 'text': {
            // An empty fill-in may leave only "　" behind, so trim surrounding whitespace
            const text = resolveText(el.text, values).trim();
            if (!text) break;
            const font = el.font;
            if (el.vertical) {
              // The column is 1 em wide: fit it in the box's width, then shrink until it fits its height
              let size = Math.min(el.fontSize, el.w);
              while (size > 4 && c.measureVertical(text, size, font) > el.h) size -= 0.5;
              const top = H - el.y - (el.h - c.measureVertical(text, size, font)) / 2;
              c.verticalText(text, el.x + el.w / 2, top, size, rgb, font);
            } else {
              let size = Math.min(el.fontSize, el.h / 1.1);
              while (size > 4 && c.measure(text, size, font) > el.w) size -= 0.5;
              const b = c.measureBounds(text, size, font);
              const x =
                el.align === 'left'
                  ? el.x - b.left
                  : el.align === 'right'
                    ? el.x + el.w - b.right
                    : el.x + el.w / 2 - (b.left + b.right) / 2;
              const cy = H - el.y - el.h / 2;
              c.text(text, x, cy - size * 0.36, size, rgb, font);
            }
            break;
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in samples

const el = <T extends StampElement>(e: Omit<T, 'id'> & { id?: string }): T => ({ ...e, id: e.id ?? uuid() }) as T;
const text = (
  x: number,
  y: number,
  w: number,
  h: number,
  t: string,
  fontSize: number,
  extra: Partial<TextElement> = {},
): TextElement => el<TextElement>({ type: 'text', x, y, w, h, text: t, fontSize, vertical: false, align: 'center', ...extra });

export const BUILTIN_TEMPLATES: StampTemplate[] = [
  {
    id: 'builtin-box',
    name: '四角（上段・日付・下段）',
    width: 84,
    height: 38,
    color: 'red',
    builtin: true,
    updatedAt: 0,
    elements: [
      el<RectElement>({ type: 'rect', x: 0, y: 0, w: 84, h: 38, radius: 0, strokeWidth: 1.4, fill: false }),
      text(4, 4, 76, 17, '{上段:承認}', 14),
      // Collapse this row when there is no date and the bottom line is empty
      text(4, 22, 76, 12, '{日付}　{下段:山田}', 8, { collapseIfEmpty: true }),
    ],
  },
  {
    id: 'builtin-round',
    name: '丸（横書き）',
    width: 40,
    height: 40,
    color: 'red',
    builtin: true,
    updatedAt: 0,
    elements: [
      el<EllipseElement>({ type: 'ellipse', x: 0, y: 0, w: 40, h: 40, strokeWidth: 1.4, fill: false }),
      text(5, 6, 30, 28, '{文字:済}', 22, { font: 'zen' }),
    ],
  },
  {
    id: 'builtin-round-vertical',
    name: '丸（縦書き）',
    width: 40,
    height: 40,
    color: 'red',
    builtin: true,
    updatedAt: 0,
    elements: [
      el<EllipseElement>({ type: 'ellipse', x: 0, y: 0, w: 40, h: 40, strokeWidth: 2, fill: false }),
      text(8, 6, 24, 28, '{文字:山田}', 16, { vertical: true, font: 'yuji' }),
    ],
  },
  {
    id: 'builtin-date-seal',
    name: 'データ印（上段・日付・下段）',
    width: 54,
    height: 54,
    color: 'red',
    builtin: true,
    updatedAt: 0,
    elements: [
      el<EllipseElement>({ type: 'ellipse', x: 0, y: 0, w: 54, h: 54, strokeWidth: 1.4, fill: false }),
      el<LineElement>({ type: 'line', x1: 1.6, y1: 18, x2: 52.4, y2: 18, strokeWidth: 1.1 }),
      el<LineElement>({ type: 'line', x1: 1.6, y1: 36, x2: 52.4, y2: 36, strokeWidth: 1.1 }),
      text(10, 4, 34, 13, '{上段:営業部}', 8),
      text(5, 19, 44, 16, '{短い日付}', 9.5),
      text(10, 37, 34, 13, '{下段:山田}', 8),
    ],
  },
];
