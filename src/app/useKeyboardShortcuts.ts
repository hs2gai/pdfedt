import { useEffect } from 'react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { contentHistory } from '../content-edit/history';

interface Options {
  documentId: string | null;
  /** In content editing mode, Undo/Redo target the content editing history */
  contentEdit: boolean;
  onEscape: () => void;
  /** Ctrl+C. Returns false when there is nothing to copy (the browser keeps the key) */
  onCopy: () => boolean;
  /** Ctrl+V. Returns false when there is nothing to paste (the browser keeps the key) */
  onPaste: () => boolean;
  /** Ctrl+F (the browser's find cannot see inside the PDF) */
  onFind: () => void;
  /** Ctrl+P (the browser's print would print the app screen) */
  onPrint: () => void;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Delete / Backspace deletes the selected annotations, Ctrl+C / Ctrl+V copy and paste, Ctrl+F search, Ctrl+P print, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo/redo, Esc returns to the select tool */
export function useKeyboardShortcuts({ documentId, contentEdit, onEscape, onCopy, onPaste, onFind, onPrint }: Options) {
  const { provides: annotations } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();

  useEffect(() => {
    if (!documentId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onEscape();
      const mod = e.ctrlKey || e.metaKey;
      // Also while typing (e.g. Ctrl+F again in the search box selects its text)
      if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        return onFind();
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        return onPrint();
      }
      if (isTyping(e.target)) return;
      const undo = () => (contentEdit ? contentHistory.undo() : history?.undo());
      const redo = () => (contentEdit ? contentHistory.redo() : history?.redo());
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        return redo();
      }
      if (mod && e.key.toLowerCase() === 'c') {
        if (onCopy()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (onPaste()) e.preventDefault();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotations) {
        const scope = annotations.forDocument(documentId);
        const targets = scope.getSelectedAnnotations().map((a) => ({ pageIndex: a.object.pageIndex, id: a.object.id }));
        if (targets.length) {
          e.preventDefault();
          scope.deleteAnnotations(targets);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [documentId, contentEdit, annotations, history, onEscape, onCopy, onPaste, onFind, onPrint]);
}
