import { useEffect, useSyncExternalStore } from 'react';
import type { Rect } from '@embedpdf/models';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import type { RenderCapability } from '@embedpdf/plugin-render';
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';

/**
 * Region selection for Ctrl+C: the selection plugin's marquee (drag on empty space with the select tool)
 * disappears on pointer up, so the last rect is kept here until the next click / drag / text selection / Esc
 */
export interface Region {
  pageIndex: number;
  /** pt, top-left origin */
  rect: Rect;
}

/** Marquee mode of the select tool (the plugin's default interaction mode) */
const POINTER_MODE = 'pointerMode';
/** Scale of the copied image (2 = 144 dpi) */
const COPY_SCALE = 2;

let region: Region | null = null;
const listeners = new Set<() => void>();

export const regionStore = {
  get: () => region,
  set(next: Region | null) {
    if (next === region) return;
    region = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/**
 * Keeps the marquee rect of the select tool while `enabled`; clears it when disabled or the document changes.
 * Selecting annotations afterwards (a click) drops the kept rect and the text selection, so Ctrl+C copies the annotations
 */
export function useRegionSelection(documentId: string | null, enabled: boolean) {
  const { provides: selection } = useSelectionCapability();
  const { provides: annotations } = useAnnotationCapability();
  useEffect(() => {
    if (!selection || !documentId || !enabled) return;
    const scope = selection.forDocument(documentId);
    // The annotation plugin also selects the annotations a marquee touches. Selection changes after a marquee and
    // before the next pointer press come from it and keep the rect; only a change of the selection counts
    // (other state changes keep firing while it stays selected)
    const annotationScope = annotations?.forDocument(documentId);
    let selectedKey = annotationScope?.getState().selectedUids.join(',') ?? '';
    let afterMarquee = false;
    const onPointerDown = () => {
      afterMarquee = false;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    // onMarqueeEnd is followed by onMarqueeChange(null); that null is the end itself, not a cancel
    let ending = false;
    const offs = [
      scope.onMarqueeEnd(({ pageIndex, rect, modeId }) => {
        if (modeId !== POINTER_MODE) return;
        ending = true;
        afterMarquee = true;
        scope.clear();
        regionStore.set({ pageIndex, rect });
      }),
      // A new drag, or a plain click (cancelled marquee), drops the kept region
      scope.onMarqueeChange(({ rect, modeId }) => {
        if (modeId !== POINTER_MODE) return;
        if (!rect && ending) ending = false;
        else regionStore.set(null);
      }),
      scope.onSelectionChange((range) => {
        if (range) regionStore.set(null);
      }),
    ];
    if (annotationScope) {
      offs.push(
        annotationScope.onStateChange(({ selectedUids }) => {
          const key = selectedUids.join(',');
          if (key === selectedKey) return;
          selectedKey = key;
          if (!key || afterMarquee) return;
          regionStore.set(null);
          if (scope.getFormattedSelection().length) scope.clear();
        }),
      );
    }
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      offs.forEach((off) => off());
      regionStore.set(null);
    };
  }, [selection, annotations, documentId, enabled]);
}

/** Frame of the kept region on its page. scale is the pt → px ratio */
export function RegionLayer({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const current = useSyncExternalStore(regionStore.subscribe, regionStore.get);
  if (current?.pageIndex !== pageIndex) return null;
  const { origin, size } = current.rect;
  return (
    <div
      className="region-select"
      style={{ left: origin.x * scale, top: origin.y * scale, width: size.width * scale, height: size.height * scale }}
    />
  );
}

/**
 * Copies the selected text, or the kept region as a PNG (with annotations and form values, as on screen).
 * Returns null when nothing is selected, so Ctrl+C stays with the browser.
 * The clipboard write starts synchronously with a pending blob (keeps the user activation of the key press)
 */
export function copySelection(
  selection: SelectionCapability,
  render: RenderCapability,
  documentId: string,
): Promise<'text' | 'image'> | null {
  const scope = selection.forDocument(documentId);
  if (scope.getFormattedSelection().length) {
    const blob = scope
      .getSelectedText()
      .toPromise()
      .then((lines) => new Blob([lines.join('\n')], { type: 'text/plain' }));
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(() => 'text');
  }
  const current = regionStore.get();
  if (!current) return null;
  const blob = render
    .forDocument(documentId)
    .renderPageRect({
      pageIndex: current.pageIndex,
      rect: current.rect,
      options: { scaleFactor: COPY_SCALE, withAnnotations: true, withForms: true, imageType: 'image/png' },
    })
    .toPromise();
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => 'image');
}
