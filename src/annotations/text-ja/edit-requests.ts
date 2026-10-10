import type { TextEditorRequest } from './TextEditorPopover';
import { channel } from '../../shared/channel';

/**
 * Bridge from the "Edit button in the selection menu" to the "text tool popover".
 * They are far apart in the React tree, so a small channel connects them.
 */
export interface EditTextRequest extends TextEditorRequest {
  /** Existing annotation being edited. Deleted and recreated on confirm */
  annotationId: string;
  /** Arrow tip for callouts (pt, top-left origin) */
  tip?: { x: number; y: number };
  /** When true, move the arrow tip instead of the text (the next click becomes the new tip) */
  retarget?: boolean;
}

const textEdits = channel<EditTextRequest>();
export const requestTextEdit = textEdits.emit;
export const onTextEditRequest = textEdits.on;
