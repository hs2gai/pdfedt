import { calculateRotatedRectAABB, type Rect } from '@embedpdf/models';

export interface StampPlacement {
  /** Scale relative to the natural size of the appearance (1 = as designed) */
  scale?: number;
  /** Clockwise degrees around the center */
  rotation?: number;
}

/**
 * Annotation rects for a stamp centered at `center` (pt, top-left origin).
 * With a rotation, `rect` is the axis-aligned bounds and `unrotatedRect` the stamp itself (embedpdf's convention).
 */
export function stampRects(
  center: { x: number; y: number },
  size: { width: number; height: number },
  { scale = 1, rotation = 0 }: StampPlacement = {},
): { rect: Rect; unrotatedRect?: Rect; rotation?: number } {
  const width = size.width * scale;
  const height = size.height * scale;
  const rect: Rect = { origin: { x: center.x - width / 2, y: center.y - height / 2 }, size: { width, height } };
  if (rotation % 360 === 0) return { rect };
  return { rect: calculateRotatedRectAABB(rect, rotation), unrotatedRect: rect, rotation };
}

/** Center and scale of an existing stamp, so a regenerated one keeps its place and size */
export function stampPlacementOf(
  annotation: { rect: Rect; unrotatedRect?: Rect; rotation?: number },
  templateWidth: number,
): { center: { x: number; y: number }; placement: StampPlacement } {
  const r = annotation.unrotatedRect ?? annotation.rect;
  return {
    center: { x: r.origin.x + r.size.width / 2, y: r.origin.y + r.size.height / 2 },
    placement: { scale: r.size.width / templateWidth, rotation: annotation.rotation ?? 0 },
  };
}
