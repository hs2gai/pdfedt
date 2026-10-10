import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { useActiveDocument, useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import type { PdfRuntime } from '../pdf/engine';
import { forgetDocument, mustRegisterBeforeRendering, registerOpenedDocument, rememberPassword } from '../pdf/export';
import { prepareDisplayFonts } from '../pdf/fonts/display-fonts';
import { contentEditStore } from '../content-edit/store';
import { contentHistory } from '../content-edit/history';
import { getRecentBytes, putRecent, sourceKeyOf, touchRecent, useRecentList, type RecentMeta } from './recent-store';
import { useOpenFromUrl } from './useOpenFromUrl';
import { appSettings } from './settings';
import { uuid } from '../shared/uuid';
import { nextPaint, whenReady } from '../shared/next-paint';
import { isFirstPageRendered } from '../viewer/PdfPages';
import { useT } from '../i18n';

/** Steps of opening a document, shown by the loading overlay */
export type OpenPhase = 'reading' | 'fonts' | 'opening' | 'rendering' | 'preparing';
export interface OpeningState {
  name: string;
  /** Bytes */
  size: number;
  phase: OpenPhase;
}

/** Upper bound on waiting for the first page before preparing saves (a page may fail to render) */
const FIRST_PAGE_WAIT_MS = 5000;

interface Options {
  runtime: PdfRuntime;
  /** Called before a document replaces the open one (reset tools and modes) */
  onOpening: () => void;
  onStatus: (msg: string) => void;
}

/**
 * Opening documents: from a file, from "recent files", from the extension's URL, and the auto-resume at startup.
 * Keeps the "recent files" entry of the open document
 */
export function useDocumentOpener({ runtime, onOpening, onStatus }: Options) {
  const t = useT();
  const { provides: docs } = useDocumentManagerCapability();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const recent = useRecentList();
  const [recentEntry, setRecentEntry] = useState<RecentMeta | null>(null);
  // Opening in progress (null when idle). PDFium blocks the main thread, so each step is committed and painted
  // before its work starts (a plain state update may only render after that work on a slow machine)
  const [opening, setOpening] = useState<OpeningState | null>(null);
  const showOpening = async (update: SetStateAction<OpeningState | null>) => {
    await Promise.resolve(); // flushSync is not allowed while React runs an effect
    flushSync(() => setOpening(update));
    await nextPaint();
  };
  const toPhase = (phase: OpenPhase) => showOpening((o) => o && { ...o, phase });
  // Bytes at open time. When loading completes (including after a password retry),
  // record them as the baseline before any change (used to slim down incremental saves).
  // That walks every page, so it waits until the first page is on screen; the overlay keeps input out meanwhile
  const buffers = useRef(new Map<string, Uint8Array>());
  useEffect(() => {
    const status = activeDocument?.status;
    if (!activeDocumentId || (status !== 'loaded' && status !== 'error')) return;
    const original = buffers.current.get(activeDocumentId);
    // An error (including the password prompt) ends the overlay; a retried password loads again with the bytes kept
    if (status === 'error' || !original) return setOpening(null);
    buffers.current.delete(activeDocumentId);
    const documentId = activeDocumentId;
    if (mustRegisterBeforeRendering(runtime, documentId)) {
      registerOpenedDocument(runtime, documentId, original);
      return setOpening(null);
    }
    void (async () => {
      await toPhase('rendering');
      await whenReady(isFirstPageRendered, FIRST_PAGE_WAIT_MS);
      await toPhase('preparing');
      if (docs?.getDocument(documentId)) registerOpenedDocument(runtime, documentId, original);
      setOpening(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, activeDocumentId, activeDocument?.status]);

  /** `password`: open password already known (reopening an encrypted document after page operations) */
  const openBytes = async (bytes: Uint8Array, entry: RecentMeta, password?: string) => {
    if (!docs) return;
    await showOpening({ name: entry.name, size: bytes.byteLength, phase: 'fonts' });
    try {
      // Prepare display fonts for non-embedded fonts first (PDFium requests them synchronously while rendering, so this must happen before opening)
      await prepareDisplayFonts(runtime.pdfium, runtime.fonts, bytes, appSettings.get().localFonts);
      await toPhase('opening');
    } catch (e) {
      setOpening(null);
      throw e;
    }
    onOpening();
    contentHistory.clear();
    contentEditStore.reset();
    if (entry.contentEdited) contentEditStore.set({ edited: true });
    if (activeDocumentId) {
      forgetDocument(activeDocumentId);
      docs.closeDocument(activeDocumentId);
    }
    setRecentEntry(entry);
    // The ID is ours, so the bytes are in place whenever the document reports "loaded" (before or after this task's callback)
    const documentId = uuid();
    buffers.current.set(documentId, bytes);
    docs.openDocumentBuffer({ buffer: bytes.buffer as ArrayBuffer, name: entry.name, password, documentId }).wait(
      () => {
        if (password) rememberPassword(documentId, password);
      },
      () => {
        buffers.current.delete(documentId);
        setOpening(null);
      },
    );
  };
  const openFile = async (file: File, sourceKey = sourceKeyOf(file)) => {
    if (!docs) return;
    await showOpening({ name: file.name, size: file.size, phase: 'reading' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Reopening the same file reuses its entry in the list (the in-progress state is replaced by the opened content)
    const entry: RecentMeta = {
      id: recent.find((m) => m.sourceKey === sourceKey)?.id ?? uuid(),
      name: file.name,
      sourceKey,
      size: bytes.byteLength,
      savedAt: Date.now(),
      contentEdited: false,
    };
    await openBytes(bytes, entry);
    await putRecent(entry, bytes, bytes);
  };
  const openRecent = async (meta: RecentMeta) => {
    await showOpening({ name: meta.name, size: meta.size, phase: 'reading' });
    const bytes = await getRecentBytes(meta.id);
    if (!bytes) {
      setOpening(null);
      onStatus(t('app.recentMissing'));
      return;
    }
    await openBytes(bytes, meta);
    await touchRecent(meta.id);
  };

  // Extension: fetch and open the PDF opened in the browser (#src=<URL>)
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const openingFromUrl = useOpenFromUrl(
    !!docs,
    useCallback((file: File, sourceKey: string) => openFileRef.current(file, sourceKey), []),
    onStatus,
  );
  // Auto-open the last session at startup (when the setting is on; only once, when the list is first loaded)
  const autoResumed = useRef(false);
  useEffect(() => {
    if (
      autoResumed.current ||
      openingFromUrl ||
      !docs ||
      activeDocumentId ||
      !recent[0] ||
      !appSettings.get().autoResume
    )
      return;
    autoResumed.current = true;
    void openRecent(recent[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, docs]);

  return { recent, recentEntry, opening, openBytes, openFile, openRecent };
}
