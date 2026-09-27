import { contentEditStore } from './store';

/** One undoable operation. undo / redo apply to PDFium and re-render */
export interface HistoryEntry {
  label: string;
  undo(): void;
  redo(): void;
  /** Release the retained page objects (when dropped from history) */
  dispose?(): void;
}

const LIMIT = 50;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];

const publish = () => contentEditStore.set({ history: { undo: undoStack.length, redo: redoStack.length } });

/** Undo/Redo for content editing mode. Independent of the annotation history (history plugin) */
export const contentHistory = {
  push(entry: HistoryEntry) {
    undoStack.push(entry);
    if (undoStack.length > LIMIT) undoStack.shift()?.dispose?.();
    redoStack.forEach((e) => e.dispose?.());
    redoStack = [];
    publish();
  },
  undo() {
    const e = undoStack.pop();
    if (!e) return;
    e.undo();
    redoStack.push(e);
    publish();
  },
  redo() {
    const e = redoStack.pop();
    if (!e) return;
    e.redo();
    undoStack.push(e);
    publish();
  },
  clear() {
    [...undoStack, ...redoStack].forEach((e) => e.dispose?.());
    undoStack = [];
    redoStack = [];
    publish();
  },
};
