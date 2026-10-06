import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useDocumentManagerCapability, useActiveDocument } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useFormCapability } from '@embedpdf/plugin-form/react';
import { useViewportCapability } from '@embedpdf/plugin-viewport/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useRegistry } from '@embedpdf/core/react';
import type { PdfRuntime } from '../pdf/engine';
import { PdfPages } from '../viewer/PdfPages';
import { copySelection, regionStore, useRegionSelection } from '../viewer/RegionSelection';
import { ThumbnailSidebar } from '../viewer/ThumbnailSidebar';
import { SearchBar } from '../viewer/SearchBar';
import { printDocument } from '../viewer/print';
import { useSelectionDebug } from '../viewer/useSelectionDebug';
import { Toolbar } from '../annotations/Toolbar';
import { TextJaTool } from '../annotations/text-ja/TextJaTool';
import { StampTool } from '../annotations/stamps/StampTool';
import { useDropZone } from './useDropZone';
import { useOpenFromUrl } from './useOpenFromUrl';
import { exportDocument, registerOpenedDocument, forgetDocument, rememberPassword } from '../pdf/export';
import { configureAnnotationTools } from '../annotations/tools-setup';
import { clearAnnotationClipboard, copyAnnotations, hasAnnotationClipboard, pasteAnnotations } from '../annotations/clipboard';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { DocumentBadges } from './DocumentBadges';
import { useDocumentInfo } from './useDocumentInfo';
import { ContentEditMode } from '../content-edit/ContentEditMode';
import { ContentEditGate } from '../content-edit/ContentEditGate';
import { ContentEditLayer } from '../content-edit/ContentEditLayer';
import { contentEditStore, useContentEditState } from '../content-edit/store';
import { contentHistory } from '../content-edit/history';
import { getRecentBytes, putRecent, sourceKeyOf, touchRecent, useRecentList, type RecentMeta } from './recent-store';
import { useRecentSnapshot } from './useRecentSnapshot';
import { usePageOperations } from './usePageOperations';
import { useResetDocument } from './useResetDocument';
import { formatSavedAt } from './RecentMenu';
import { appSettings } from './settings';
import { Brand } from './Brand';
import { prepareDisplayFonts } from '../pdf/fonts/display-fonts';
import { uuid } from '../shared/uuid';
import { useT } from '../i18n';

/** Tool ID. 'select' clears the annotation plugin's tool; 'textJa' is our own tool */
export type ToolId =
  | 'select'
  /** Content editing mode only: select the original text / shapes / images */
  | 'content'
  | 'textJa'
  | 'callout'
  | 'stamp'
  | 'image'
  | 'textComment'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'square'
  | 'circle'
  | 'line'
  | 'lineArrow';

export function EditorShell({ runtime }: { runtime: PdfRuntime }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  const { provides: form } = useFormCapability();
  const { activeDocumentId, activeDocument } = useActiveDocument();
  const [tool, setTool] = useState<ToolId>('select');
  const [status, setStatus] = useState('');
  const t = useT();
  // On narrow screens (phones) start with the page list closed (pages would get too small)
  const [showThumbs, setShowThumbs] = useState(() => window.innerWidth >= 700);
  const loaded = activeDocument?.status === 'loaded';
  const info = useDocumentInfo(runtime, activeDocumentId, loaded);
  // Content editing mode: off → gate (confirming) → on
  const [contentEdit, setContentEdit] = useState<'off' | 'gate' | 'on'>('off');
  const { edited: contentEdited } = useContentEditState();

  useEffect(() => {
    if (annotations) configureAnnotationTools(annotations);
  }, [annotations]);

  // Development aid: expose plugin state to the browser console
  const { provides: viewportCap } = useViewportCapability();
  const { provides: scrollCap } = useScrollCapability();
  const { registry } = useRegistry();
  useEffect(() => {
    // Exposed only in development and in the E2E build (VITE_E2E=1)
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
      (window as unknown as { __pdf: unknown }).__pdf = {
        runtime,
        registry,
        viewportCap,
        scrollCap,
        docs,
        annotations,
        // For spikes: send the saved result to Vite's spike-sink (_spike-out/)
        saveTo: async (kind: 'incremental' | 'full' | 'flatten', name: string) => {
          if (!activeDocumentId) return 'no document';
          await annotations?.forDocument(activeDocumentId).commit().toPromise();
          const bytes = exportDocument(runtime, activeDocumentId, kind);
          const r = await fetch(`/__spike/save?name=${encodeURIComponent(name)}`, {
            method: 'POST',
            body: bytes as BodyInit,
          });
          return `${name}: ${bytes.byteLength} bytes (${r.status})`;
        },
      };
    }
  }, [runtime, registry, viewportCap, scrollCap, docs, annotations, activeDocumentId]);

  // Recent files. Holds the entry for the open document and writes it back on every change
  const recent = useRecentList();
  const [recentEntry, setRecentEntry] = useState<RecentMeta | null>(null);

  /** `password`: open password already known (reopening an encrypted document after page operations) */
  const openBytes = async (bytes: Uint8Array, entry: RecentMeta, password?: string) => {
    if (!docs) return;
    // Prepare display fonts for non-embedded fonts first (PDFium requests them synchronously while rendering, so this must happen before opening)
    await prepareDisplayFonts(runtime.pdfium, runtime.fonts, bytes, appSettings.get().localFonts);
    setContentEdit('off');
    contentHistory.clear();
    contentEditStore.reset();
    if (entry.contentEdited) contentEditStore.set({ edited: true });
    if (activeDocumentId) {
      forgetDocument(activeDocumentId);
      docs.closeDocument(activeDocumentId);
    }
    setTool('select');
    setRecentEntry(entry);
    docs.openDocumentBuffer({ buffer: bytes.buffer as ArrayBuffer, name: entry.name, password }).wait(
      ({ documentId }) => {
        buffers.current.set(documentId, bytes);
        if (password) rememberPassword(documentId, password);
      },
      () => {},
    );
  };
  const openFile = async (file: File, sourceKey = sourceKeyOf(file)) => {
    if (!docs) return;
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
    const bytes = await getRecentBytes(meta.id);
    if (!bytes) {
      setStatus(t('app.recentMissing'));
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
    setStatus,
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
  useRecentSnapshot({
    runtime,
    documentId: activeDocumentId,
    loaded,
    annotations,
    form,
    entry: recentEntry,
    onStatus: setStatus,
  });

  // Bytes at open time. When loading completes (including after a password retry),
  // record them as the baseline before any change (used to slim down incremental saves)
  const buffers = useRef(new Map<string, Uint8Array>());
  useEffect(() => {
    if (!activeDocumentId || activeDocument?.status !== 'loaded') return;
    const original = buffers.current.get(activeDocumentId);
    if (!original) return;
    buffers.current.delete(activeDocumentId);
    registerOpenedDocument(runtime, activeDocumentId, original);
  }, [runtime, activeDocumentId, activeDocument?.status]);
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void openFile(f);
    e.target.value = '';
  };
  const dropProps = useDropZone(openFile);

  // Tool switching: the annotation plugin's tool or our own tool
  const selectTool = (next: ToolId) => {
    setTool(next);
    // Our own tools (select / textJa / callout / stamp) clear the plugin tool. 'image' is the plugin's image stamp
    const pluginTool =
      next === 'select' || next === 'content' || next === 'textJa' || next === 'callout' || next === 'stamp'
        ? null
        : next === 'image'
          ? 'stamp'
          : next;
    annotations?.setActiveTool(pluginTool);
  };
  // Even in content editing mode, annotations can be created / edited as usual while a tool other than "Content" is selected
  const contentSelecting = contentEdit === 'on' && tool === 'content';
  // Text selection or a region dragged on empty space with the select tool → Ctrl+C
  const { provides: selectionCap } = useSelectionCapability();
  const { provides: renderCap } = useRenderCapability();
  useSelectionDebug(selectionCap);
  useRegionSelection(activeDocumentId, tool === 'select');
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const copy = () => {
    // Text or a kept region first (a marquee also selects the annotations it touches; the region image includes them)
    const job = activeDocumentId && selectionCap && renderCap && copySelection(selectionCap, renderCap, activeDocumentId);
    if (!job) {
      // Otherwise the selected annotations (Ctrl+V pastes them back as copies)
      const doc = activeDocument?.document;
      if (!activeDocumentId || !annotations || !doc || contentSelecting) return false;
      const scope = annotations.forDocument(activeDocumentId);
      const count = copyAnnotations(runtime, scope, doc, scope.getSelectedAnnotations());
      if (count) setStatus(t('copy.annotations', { count }));
      return count > 0;
    }
    // Copying text / an image replaces what Ctrl+V should paste
    clearAnnotationClipboard();
    job.then(
      (kind) => setStatus(t(kind === 'text' ? 'copy.text' : 'copy.image')),
      (e: unknown) => setStatus(t('copy.failed', { message: errorText(e) })),
    );
    return true;
  };
  // Text search (Ctrl+F). focusKey moves the focus back to an already open bar
  const [search, setSearch] = useState<{ open: boolean; focusKey: number }>({ open: false, focusKey: 0 });
  const openSearch = () => setSearch((s) => ({ open: true, focusKey: s.focusKey + 1 }));
  const closeSearch = () => setSearch((s) => ({ ...s, open: false }));
  // Printing renders every page first; one run at a time
  const [printing, setPrinting] = useState(false);
  const canPrint = loaded && (info?.canPrint ?? true);
  const print = async () => {
    const doc = activeDocument?.document;
    if (!activeDocumentId || !doc || !renderCap || printing) return;
    if (!canPrint) return setStatus(t('toolbar.print.blocked'));
    setPrinting(true);
    try {
      // Flush annotation changes so the page images include them
      await annotations?.forDocument(activeDocumentId).commit().toPromise();
      await printDocument(renderCap, doc, (done, total) => setStatus(t('print.preparing', { done, total })));
      setStatus('');
    } catch (e) {
      setStatus(t('print.failed', { message: errorText(e) }));
    } finally {
      setPrinting(false);
    }
  };
  const paste = () => {
    const doc = activeDocument?.document;
    if (!activeDocumentId || !annotations || !doc || !scrollCap || contentSelecting || !hasAnnotationClipboard()) return false;
    if (info && !info.canAnnotate) {
      setStatus(t('toolbar.annotateBlocked'));
      return true;
    }
    const pageIndex = scrollCap.forDocument(activeDocumentId).getCurrentPage() - 1;
    pasteAnnotations(annotations.forDocument(activeDocumentId), doc, pageIndex).then(
      (count) => count && setStatus(t('paste.annotations', { count })),
      (e: unknown) => setStatus(t('paste.failed', { message: errorText(e) })),
    );
    return true;
  };
  useKeyboardShortcuts({
    documentId: activeDocumentId,
    contentEdit: contentSelecting,
    onEscape: () => {
      regionStore.set(null);
      selectTool(contentEdit === 'on' ? 'content' : 'select');
    },
    onCopy: copy,
    onPaste: paste,
    onFind: openSearch,
    onPrint: () => void print(),
  });

  // Page operations from the thumbnails. Not allowed for signature-locked documents or during content editing
  const pageOps = usePageOperations({
    runtime,
    documentId: activeDocumentId,
    annotations,
    scroll: scrollCap,
    entry: recentEntry,
    reopen: openBytes,
    onStatus: setStatus,
  });
  const resetDoc = useResetDocument({ documentId: activeDocumentId, entry: recentEntry, reopen: openBytes, onStatus: setStatus });
  const pagesEditable = loaded && contentEdit !== 'on' && (info?.canModify ?? true) && !(info && info.signatures > 0 && (info.docMdp === 1 || info.docMdp === 2));

  return (
    <div className="app" {...dropProps}>
      <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={onPick} />
      <Toolbar
        runtime={runtime}
        documentId={activeDocumentId}
        documentName={activeDocument?.name}
        tool={tool}
        onSelectTool={selectTool}
        onOpen={() => fileInput.current?.click()}
        onOpenRecent={openRecent}
        onStatus={setStatus}
        showThumbs={showThumbs}
        onToggleThumbs={() => setShowThumbs((v) => !v)}
        contentEdit={contentEdit === 'on'}
        contentEdited={contentEdited}
        onToggleContentEdit={() => {
          if (contentEdit === 'on') {
            setContentEdit('off');
            selectTool('select');
          } else setContentEdit('gate');
        }}
        canAnnotate={info?.canAnnotate ?? true}
        canModify={info?.canModify ?? true}
        onRotatePage={
          pagesEditable && activeDocumentId && scrollCap
            ? (turns) => pageOps.rotatePage(scrollCap.forDocument(activeDocumentId).getCurrentPage() - 1, turns)
            : undefined
        }
        pagesBusy={pageOps.busy}
        searchOpen={search.open}
        onToggleSearch={() => (search.open ? closeSearch() : openSearch())}
        canPrint={canPrint}
        printing={printing}
        onPrint={() => void print()}
        onReset={resetDoc.request}
      />
      {search.open && activeDocumentId && loaded && (
        <SearchBar key={activeDocumentId} documentId={activeDocumentId} focusKey={search.focusKey} onClose={closeSearch} />
      )}
      {loaded && <DocumentBadges info={info} />}
      {contentEdit === 'gate' && (
        <ContentEditGate
          info={info}
          onConfirm={() => {
            selectTool('content');
            setContentEdit('on');
          }}
          onCancel={() => setContentEdit('off')}
        />
      )}
      {status && <div className="status-bar">{status}</div>}
      {pageOps.dialog}
      {resetDoc.dialog}
      {activeDocumentId && loaded && (
        <ContentEditMode
          runtime={runtime}
          documentId={activeDocumentId}
          active={contentEdit === 'on'}
          selecting={contentSelecting}
          onPickAnnotation={() => selectTool('select')}
          onPickContent={() => selectTool('content')}
        />
      )}
      <div className="viewer">
        {activeDocumentId ? (
          <>
            {showThumbs && (
              <ThumbnailSidebar
                documentId={activeDocumentId}
                pageCount={activeDocument?.document?.pageCount ?? 0}
                onDeletePage={pagesEditable ? pageOps.requestDelete : undefined}
                onMovePage={pagesEditable ? pageOps.movePage : undefined}
                onImportPdf={pagesEditable ? pageOps.importPdf : undefined}
              />
            )}
            <PdfPages
              documentId={activeDocumentId}
              annotationsInert={contentSelecting}
              pageOverlay={
                contentSelecting
                  ? (pageIndex, scale) => <ContentEditLayer pageIndex={pageIndex} scale={scale} />
                  : undefined
              }
            />
            <TextJaTool
              runtime={runtime}
              documentId={activeDocumentId}
              active={tool === 'textJa' || tool === 'callout'}
              callout={tool === 'callout'}
              onDone={() => selectTool('select')}
            />
            <StampTool
              runtime={runtime}
              documentId={activeDocumentId}
              active={tool === 'stamp'}
              onDone={() => selectTool('select')}
            />
          </>
        ) : (
          <div className="empty">
            <Brand size="large" />
            <p>{t('app.dropHint')}</p>
            <p className="muted">{t('app.privacyNote')}</p>
            {recent[0] && (
              <button className="resume-btn" onClick={() => openRecent(recent[0])}>
                {t('app.resume', { name: recent[0].name, savedAt: formatSavedAt(recent[0].savedAt) })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
