import type { Position, Rect } from '@embedpdf/models';

export const area = (r: Rect) => r.size.width * r.size.height;

/** Whether p lies within r (edges included) */
export const contains = (r: Rect, p: Position) =>
  p.x >= r.origin.x && p.x <= r.origin.x + r.size.width && p.y >= r.origin.y && p.y <= r.origin.y + r.size.height;

/** Whether inner lies entirely within outer */
export const encloses = (outer: Rect, inner: Rect) =>
  inner.origin.x >= outer.origin.x &&
  inner.origin.y >= outer.origin.y &&
  inner.origin.x + inner.size.width <= outer.origin.x + outer.size.width &&
  inner.origin.y + inner.size.height <= outer.origin.y + outer.size.height;

/** The rect spanned by two corner points, in any order */
export const rectFrom = (a: Position, b: Position): Rect => ({
  origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  size: { width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
});
