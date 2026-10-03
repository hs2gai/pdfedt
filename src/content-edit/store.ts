import { useSyncExternalStore } from 'react';
import type { Rect } from '@embedpdf/models';
import type { PageObjectInfo } from './page-objects';

/** UI state of content editing mode (per-page object list, selection, in-progress display) */
export interface ContentEditState {
  /** pageIndex → object list (re-read after edits) */
  objects: Record<number, PageObjectInfo[]>;
  selection: { pageIndex: number; indexes: number[] } | null;
  /** Movement while dragging (pt, top-left origin) */
  dragDelta: { dx: number; dy: number } | null;
  /** Marquee selection area (pt, top-left origin) */
  marquee: { pageIndex: number; rect: Rect } | null;
  /** Whether background objects (PageObjectInfo.background) are shown and selectable */
  showBackground: boolean;
  /** Whether content was rewritten in this mode (used to decide the save kind) */
  edited: boolean;
  /** Number of undoable / redoable operations (updated by history.ts) */
  history: { undo: number; redo: number };
}

const initial: ContentEditState = {
  objects: {},
  selection: null,
  dragDelta: null,
  marquee: null,
  showBackground: false,
  edited: false,
  history: { undo: 0, redo: 0 },
};

let state = initial;
const listeners = new Set<() => void>();

export const contentEditStore = {
  get: () => state,
  set(patch: Partial<ContentEditState> | ((s: ContentEditState) => Partial<ContentEditState>)) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  reset() {
    state = initial;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Objects that are shown and selectable (background objects only when the user chose to show them) */
export const pickableObjects = (list: PageObjectInfo[], showBackground: boolean) =>
  showBackground ? list : list.filter((o) => !o.background);

export function useContentEditState(): ContentEditState {
  return useSyncExternalStore(contentEditStore.subscribe, contentEditStore.get);
}
