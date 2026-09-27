import { useEffect, useRef } from 'react';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { FormCapability } from '@embedpdf/plugin-form';
import type { PdfRuntime } from '../pdf/engine';
import { exportDocument } from '../pdf/export';
import { contentEditStore } from '../content-edit/store';
import { putRecent, type RecentMeta } from './recent-store';
import { t } from '../i18n';

const DEBOUNCE_MS = 1000;

/**
 * Writes the latest state of the open document back to "recent files".
 * Annotation / content edits are saved together (after DEBOUNCE_MS), and immediately when the tab is hidden.
 * While a document is open, the browser asks for confirmation before reload / closing the tab.
 */
export function useRecentSnapshot({
  runtime,
  documentId,
  loaded,
  annotations,
  form,
  entry,
  onStatus,
}: {
  runtime: PdfRuntime;
  documentId: string | null;
  loaded: boolean;
  annotations: AnnotationCapability | null;
  form: FormCapability | null;
  /** The list entry for this document (decided when opened) */
  entry: RecentMeta | null;
  onStatus: (msg: string) => void;
}) {
  const latest = useRef({ documentId, loaded, annotations, entry });
  latest.current = { documentId, loaded, annotations, entry };

  useEffect(() => {
    let timer: number | undefined;
    let running = false;
    let again = false;

    const snapshot = async () => {
      const { documentId, loaded, annotations, entry } = latest.current;
      if (!documentId || !loaded || !entry) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        // Flush uncommitted annotation changes to PDFium before exporting
        await annotations?.forDocument(documentId).commit().toPromise();
        const { edited } = contentEditStore.get();
        const bytes = exportDocument(runtime, documentId, edited ? 'full' : 'incremental');
        await putRecent({ ...entry, size: bytes.byteLength, savedAt: Date.now(), contentEdited: edited }, bytes);
      } catch (e) {
        onStatus(t('app.autosaveFailed', { message: (e as Error).message }));
      } finally {
        running = false;
        if (again) {
          again = false;
          void snapshot();
        }
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(snapshot, DEBOUNCE_MS);
    };
    const flush = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      void snapshot();
    };

    const offAnnot = annotations?.onAnnotationEvent((ev) => {
      if (ev.type !== 'loaded' && ev.documentId === latest.current.documentId) schedule();
    });
    // Form input counts as a change too
    const offForm = form?.onFieldValueChange((ev) => {
      if (ev.documentId === latest.current.documentId) schedule();
    });
    // Content editing: the page object list is re-read after every rewrite
    let prevObjects = contentEditStore.get().objects;
    const offEdit = contentEditStore.subscribe(() => {
      const s = contentEditStore.get();
      if (s.edited && s.objects !== prevObjects) schedule();
      prevObjects = s.objects;
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      offAnnot?.();
      offForm?.();
      offEdit();
      document.removeEventListener('visibilitychange', onHidden);
      window.clearTimeout(timer);
    };
  }, [runtime, annotations, form, onStatus]);

  // Confirm before reload / closing the tab while a document is open
  useEffect(() => {
    if (!documentId) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [documentId]);
}
