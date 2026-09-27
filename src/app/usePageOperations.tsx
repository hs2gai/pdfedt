import { useState } from 'react';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { PdfRuntime } from '../pdf/engine';
import { getDocPtr } from '../pdf/raw';
import { exportDocument, openPasswordOf } from '../pdf/export';
import { deletePage, importPdf, movePage } from '../pdf/pages';
import type { RecentMeta } from './recent-store';
import { useT } from '../i18n';

interface Options {
  runtime: PdfRuntime;
  documentId: string | null;
  annotations: AnnotationCapability | null;
  scroll: ScrollCapability | null;
  /** "Recent files" entry of the open document */
  entry: RecentMeta | null;
  /** Reopen the document (EditorShell's openBytes). `password` keeps an encrypted document open without asking again */
  reopen: (bytes: Uint8Array, entry: RecentMeta, password?: string) => Promise<void>;
  onStatus: (msg: string) => void;
}

/**
 * Page operations from the thumbnails (delete, reorder, add a PDF).
 * After changing the page structure with raw PDFium, reopen the document from bytes equivalent to a full save.
 * Reopening keeps annotations, thumbnails and scroll state consistent, and the document is treated like
 * "content edited" (no incremental save; full save uses a new name).
 */
export function usePageOperations({ runtime, documentId, annotations, scroll, entry, reopen, onStatus }: Options) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const t = useT();

  const restructure = async (label: string, op: (docPtr: number) => void, focusPage: number) => {
    if (!documentId || !entry) return;
    try {
      // Flush uncommitted annotation changes to PDFium before changing the structure
      await annotations?.forDocument(documentId).commit().toPromise();
      op(getDocPtr(runtime.native, documentId));
      const bytes = exportDocument(runtime, documentId, 'full');
      await reopen(bytes, { ...entry, size: bytes.byteLength, contentEdited: true }, openPasswordOf(documentId) || undefined);
      onStatus(t('pages.restructured', { label }));
      // Wait for the re-render after reopening, then go to the affected page
      window.setTimeout(() => scroll?.scrollToPage({ pageNumber: focusPage + 1, behavior: 'instant' }), 300);
    } catch (e) {
      onStatus(t('pages.failed', { label, message: (e as Error).message }));
    }
  };

  const doDelete = (index: number) => {
    setConfirmDelete(null);
    void restructure(t('pages.deleted', { page: index + 1 }), (doc) => deletePage(runtime.pdfium, doc, index), Math.max(0, index - 1));
  };
  const doMove = (from: number, to: number) => {
    if (to === from || to === from + 1) return; // same position
    void restructure(
      t('pages.moved', { page: from + 1 }),
      (doc) => movePage(runtime.pdfium, doc, from, to),
      to > from ? to - 1 : to,
    );
  };
  const doImport = async (file: File, insertIndex: number) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let count = 0;
    await restructure(
      t('pages.imported', { name: file.name }),
      (doc) => {
        count = importPdf(runtime.pdfium, doc, bytes, insertIndex);
      },
      insertIndex,
    );
    return count;
  };

  const dialog =
    confirmDelete === null ? null : (
      <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <h2>{t('pages.confirmDelete.title', { page: confirmDelete + 1 })}</h2>
          <ul className="warnings">
            <li className="warn">{t('pages.confirmDelete.lost')}</li>
            <li>{t('pages.confirmDelete.saveAs')}</li>
          </ul>
          <div className="modal-actions">
            <button type="button" onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" onClick={() => doDelete(confirmDelete)}>
              {t('pages.confirmDelete.ok')}
            </button>
          </div>
        </div>
      </div>
    );

  return {
    requestDelete: (index: number) => setConfirmDelete(index),
    movePage: doMove,
    importPdf: (file: File, insertIndex: number) => void doImport(file, insertIndex),
    dialog,
  };
}
