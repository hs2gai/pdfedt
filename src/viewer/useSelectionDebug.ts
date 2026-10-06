import { useEffect } from 'react';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { debugEnabled, debugLog } from '../shared/debug';

type Rect = { origin: { x: number; y: number }; size: { width: number; height: number }; vertical?: boolean };
const short = (r: Rect) => [r.origin.x, r.origin.y, r.size.width, r.size.height, r.vertical ? 'V' : ''].join(',');

/** Logs each finished text selection: the glyph range and the rects it became (see shared/debug.ts) */
export function useSelectionDebug(selection: SelectionCapability | null) {
  useEffect(() => {
    if (!selection || !debugEnabled()) return;
    // Kept from the last change: tools such as underline consume and clear the selection before the end event
    let last: { range: unknown; rects: Record<string, string[]> } | null = null;
    const offChange = selection.onSelectionChange((ev) => {
      if (!ev.selection) return;
      const rects = selection.getHighlightRects(ev.documentId) as Record<number, Rect[]>;
      last = {
        range: ev.selection,
        rects: Object.fromEntries(Object.entries(rects).map(([page, list]) => [page, list.map(short)])),
      };
    });
    const offEnd = selection.onEndSelection(() => {
      if (last) debugLog('selection', last.range, last.rects);
      last = null;
    });
    return () => {
      offChange();
      offEnd();
    };
  }, [selection]);
}
