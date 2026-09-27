import type { TextEditorRequest } from './TextEditorPopover';

/**
 * Bridge from the "Edit button in the selection menu" to the "text tool popover".
 * They are far apart in the React tree, so a small pub/sub connects them.
 */
export interface EditTextRequest extends TextEditorRequest {
  /** Existing annotation being edited. Deleted and recreated on confirm */
  annotationId: string;
  /** Arrow tip for callouts (pt, top-left origin) */
  tip?: { x: number; y: number };
  /** When true, move the arrow tip instead of the text (the next click becomes the new tip) */
  retarget?: boolean;
}

type Listener = (req: EditTextRequest) => void;
const listeners = new Set<Listener>();

export function requestTextEdit(req: EditTextRequest) {
  listeners.forEach((l) => l(req));
}

export function onTextEditRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
