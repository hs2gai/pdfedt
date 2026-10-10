import { useActiveDocument } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import type { PdfRuntime } from '../pdf/engine';
import type { DocumentInfo } from '../pdf/inspector';
import { copySelection } from '../viewer/RegionSelection';
import { useSelectionDebug } from '../viewer/useSelectionDebug';
import {
  clearAnnotationClipboard,
  copyAnnotations,
  hasAnnotationClipboard,
  pasteAnnotations,
} from '../annotations/clipboard';
import { errorText } from '../shared/errors';
import { useT } from '../i18n';

interface Options {
  runtime: PdfRuntime;
  info: DocumentInfo | null;
  /** The "Content" tool is selected in content editing mode (annotations are not copied / pasted then) */
  contentSelecting: boolean;
  onStatus: (msg: string) => void;
}

/**
 * Ctrl+C / Ctrl+V. Copy takes selected text or a dragged region first, otherwise the selected annotations;
 * paste puts copied annotations on the current page. Each returns whether it handled the key
 */
export function useClipboardActions({ runtime, info, contentSelecting, onStatus }: Options) {
  const t = useT();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const { provides: annotations } = useAnnotationCapability();
  const { provides: scrollCap } = useScrollCapability();
  const { provides: selectionCap } = useSelectionCapability();
  const { provides: renderCap } = useRenderCapability();
  useSelectionDebug(selectionCap);

  const copy = () => {
    // Text or a kept region first (a marquee also selects the annotations it touches; the region image includes them)
    const job =
      activeDocumentId && selectionCap && renderCap && copySelection(selectionCap, renderCap, activeDocumentId);
    if (!job) {
      // Otherwise the selected annotations (Ctrl+V pastes them back as copies)
      const doc = activeDocument?.document;
      if (!activeDocumentId || !annotations || !doc || contentSelecting) return false;
      const scope = annotations.forDocument(activeDocumentId);
      const count = copyAnnotations(runtime, scope, doc, scope.getSelectedAnnotations());
      if (count) onStatus(t('copy.annotations', { count }));
      return count > 0;
    }
    // Copying text / an image replaces what Ctrl+V should paste
    clearAnnotationClipboard();
    job.then(
      (kind) => onStatus(t(kind === 'text' ? 'copy.text' : 'copy.image')),
      (e: unknown) => onStatus(t('copy.failed', { message: errorText(e) })),
    );
    return true;
  };

  const paste = () => {
    const doc = activeDocument?.document;
    if (!activeDocumentId || !annotations || !doc || !scrollCap || contentSelecting || !hasAnnotationClipboard())
      return false;
    if (info && !info.canAnnotate) {
      onStatus(t('toolbar.annotateBlocked'));
      return true;
    }
    const pageIndex = scrollCap.forDocument(activeDocumentId).getCurrentPage() - 1;
    pasteAnnotations(annotations.forDocument(activeDocumentId), doc, pageIndex).then(
      (count) => count && onStatus(t('paste.annotations', { count })),
      (e: unknown) => onStatus(t('paste.failed', { message: errorText(e) })),
    );
    return true;
  };

  return { copy, paste };
}
