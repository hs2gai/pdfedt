import { useEffect } from 'react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { contentHistory } from '../content-edit/history';

interface Options {
  documentId: string | null;
  /** In content editing mode, Undo/Redo target the content editing history */
  contentEdit: boolean;
  onEscape: () => void;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Delete / Backspace deletes the selected annotations, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo/redo, Esc returns to the select tool */
export function useKeyboardShortcuts({ documentId, contentEdit, onEscape }: Options) {
  const { provides: annotations } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();

  useEffect(() => {
    if (!documentId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onEscape();
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
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
  }, [documentId, contentEdit, annotations, history, onEscape]);
}
