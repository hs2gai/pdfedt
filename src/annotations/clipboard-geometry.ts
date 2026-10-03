import { PdfAnnotationSubtype, type PdfAnnotationObject, type Position, type Rect, type Size } from '@embedpdf/models';

/** Annotation types that Ctrl+C / Ctrl+V can duplicate (links, form widgets, popups, redactions etc. are left out) */
const COPYABLE = new Set<PdfAnnotationSubtype>([
  PdfAnnotationSubtype.TEXT,
  PdfAnnotationSubtype.FREETEXT,
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.SQUARE,
  PdfAnnotationSubtype.CIRCLE,
  PdfAnnotationSubtype.POLYGON,
  PdfAnnotationSubtype.POLYLINE,
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.SQUIGGLY,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.STAMP,
  PdfAnnotationSubtype.CARET,
  PdfAnnotationSubtype.INK,
]);

export const isCopyable = (a: PdfAnnotationObject) => COPYABLE.has(a.type);

const movePoint = (p: Position, dx: number, dy: number): Position => ({ x: p.x + dx, y: p.y + dy });
const moveRect = (r: Rect, dx: number, dy: number): Rect => ({ origin: movePoint(r.origin, dx, dy), size: { ...r.size } });

/** Shifts every absolute coordinate of an annotation (rect, vertices, ink strokes, text markup rects, callout line) */
export function translateAnnotation<T extends PdfAnnotationObject>(a: T, dx: number, dy: number): T {
  // Type-specific geometry is read loosely: each field exists only on some subtypes
  const src = a as T & {
    unrotatedRect?: Rect;
    inkList?: { points: Position[] }[];
    vertices?: Position[];
    linePoints?: { start: Position; end: Position };
    segmentRects?: Rect[];
    calloutLine?: Position[];
  };
  const out: Record<string, unknown> = { ...a, rect: moveRect(a.rect, dx, dy) };
  if (src.unrotatedRect) out.unrotatedRect = moveRect(src.unrotatedRect, dx, dy);
  if (src.inkList) out.inkList = src.inkList.map((s) => ({ ...s, points: s.points.map((p) => movePoint(p, dx, dy)) }));
  if (src.vertices) out.vertices = src.vertices.map((p) => movePoint(p, dx, dy));
  if (src.linePoints) out.linePoints = { start: movePoint(src.linePoints.start, dx, dy), end: movePoint(src.linePoints.end, dx, dy) };
  if (src.segmentRects) out.segmentRects = src.segmentRects.map((r) => moveRect(r, dx, dy));
  if (src.calloutLine) out.calloutLine = src.calloutLine.map((p) => movePoint(p, dx, dy));
  return out as T;
}

/** Smallest rect that contains all the given rects */
export function unionRect(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.origin.x));
  const top = Math.min(...rects.map((r) => r.origin.y));
  const right = Math.max(...rects.map((r) => r.origin.x + r.size.width));
  const bottom = Math.max(...rects.map((r) => r.origin.y + r.size.height));
  return { origin: { x: left, y: top }, size: { width: right - left, height: bottom - top } };
}

/**
 * Offset for pasting `bounds` shifted by `shift` pt down-right, pulled back so it stays on the page.
 * When the bounds are larger than the page, the top-left edge is kept on the page
 */
export function pasteOffset(bounds: Rect, page: Size, shift: number): { dx: number; dy: number } {
  const clamp = (pos: number, len: number, limit: number) => Math.max(0, Math.min(pos, limit - len));
  const x = clamp(bounds.origin.x + shift, bounds.size.width, page.width);
  const y = clamp(bounds.origin.y + shift, bounds.size.height, page.height);
  return { dx: x - bounds.origin.x, dy: y - bounds.origin.y };
}
