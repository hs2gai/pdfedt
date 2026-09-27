import { useEffect, useRef, type ReactNode } from 'react';
import { useViewportElement } from '@embedpdf/plugin-viewport/react';
import { useZoomCapability } from '@embedpdf/plugin-zoom/react';

/**
 * Two-finger gestures on the viewport: drag to scroll, pinch to zoom (both at once).
 * The pages carry touch-action: none (the interaction manager needs raw touches, so one finger
 * works the tools instead of scrolling), which also blocks the browser's own two-finger scroll.
 * ZoomGestureWrapper's pinch is not used because it commits with the anchor captured at touchstart,
 * which throws away any panning done during the gesture. Its Ctrl + wheel zoom is kept.
 * While pinching, the content is previewed with a CSS transform; the real zoom is applied on release.
 * Must be rendered inside <Viewport>.
 */
export function TouchGestures({ documentId, children }: { documentId: string; children: ReactNode }) {
  const viewport = useViewportElement();
  const { provides: zoom } = useZoomCapability();
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport?.current;
    const target = inner.current;
    if (!el || !target || !zoom) return;
    const scope = zoom.forDocument(documentId);
    const center = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let last: { x: number; y: number } | null = null;
    let startDistance = 0;
    let scale = 1;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      last = center(e.touches);
      startDistance = distance(e.touches);
      scale = 1;
      // Scale preview around the pinch center (in the content's own coordinates)
      const r = target.getBoundingClientRect();
      target.style.transformOrigin = `${last.x - r.left}px ${last.y - r.top}px`;
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !last) return;
      const c = center(e.touches);
      el.scrollLeft -= c.x - last.x;
      el.scrollTop -= c.y - last.y;
      last = c;
      scale = distance(e.touches) / startDistance;
      target.style.transform = `scale(${scale})`;
      e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!last || e.touches.length >= 2) return;
      target.style.transform = '';
      target.style.transformOrigin = '';
      if (Math.abs(scale - 1) > 0.02) {
        const r = el.getBoundingClientRect();
        // Keep the point under the fingers where it is
        scope.requestZoomBy((scale - 1) * scope.getState().currentZoomLevel, {
          vx: last.x - r.left,
          vy: last.y - r.top,
        });
      }
      last = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [viewport, zoom, documentId]);
  return <div ref={inner}>{children}</div>;
}
