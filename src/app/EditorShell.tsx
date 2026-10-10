import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useDocumentManagerCapability, useActiveDocument } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useFormCapability } from '@embedpdf/plugin-form/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import type { PdfRuntime } from '../pdf/engine';
import { isLockedBySignature } from '../pdf/inspector';
import { PdfPages } from '../viewer/PdfPages';
import { regionStore, useRegionSelection } from '../viewer/RegionSelection';
import { ThumbnailSidebar } from '../viewer/ThumbnailSidebar';
import { SearchBar } from '../viewer/SearchBar';
import { Toolbar } from '../annotations/Toolbar';
import { TextJaTool } from '../annotations/text-ja/TextJaTool';
import { StampTool } from '../annotations/stamps/StampTool';
import { configureAnnotationTools } from '../annotations/tools-setup';
import { applyTextMarkup, hasTextSelection, isMarkupTool, useMarkupSelectionRects } from '../annotations/text-markup';
import { ContentEditMode } from '../content-edit/ContentEditMode';
import { ContentEditGate } from '../content-edit/ContentEditGate';
import { ContentEditLayer } from '../content-edit/ContentEditLayer';
import { useContentEditState } from '../content-edit/store';
import { useDropZone } from './useDropZone';
import { useDocumentOpener } from './useDocumentOpener';
import { useClipboardActions } from './useClipboardActions';
import { usePrint } from './usePrint';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { DocumentBadges } from './DocumentBadges';
import { useDocumentInfo } from './useDocumentInfo';
import { useRecentSnapshot } from './useRecentSnapshot';
import { usePageOperations } from './usePageOperations';
import { useResetDocument } from './useResetDocument';
import { formatSavedAt } from './RecentMenu';
import { Brand } from './Brand';
import { LoadingOverlay } from './LoadingOverlay';
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

  // Development aid: expose plugin state to the browser console (and to E2E)
  const { provides: scrollCap } = useScrollCapability();
  useEffect(() => {
    // Exposed only in development and in the E2E build (VITE_E2E=1)
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
      (window as unknown as { __pdf: unknown }).__pdf = { runtime, scrollCap, docs, annotations };
    }
  }, [runtime, scrollCap, docs, annotations]);

  const { recent, recentEntry, opening, openBytes, openFile, openRecent } = useDocumentOpener({
    runtime,
    onOpening: () => {
      setContentEdit('off');
      setTool('select');
    },
    onStatus: setStatus,
  });
  useRecentSnapshot({
    runtime,
    documentId: activeDocumentId,
    loaded,
    annotations,
    form,
    entry: recentEntry,
    onStatus: setStatus,
  });
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void openFile(f);
    e.target.value = '';
  };
  const dropProps = useDropZone(openFile);

  const { provides: selectionCap } = useSelectionCapability();
  useMarkupSelectionRects(selectionCap, activeDocumentId, loaded);
  // Tool switching: the annotation plugin's tool or our own tool
  const selectTool = (next: ToolId) => {
    // A markup tool with text already selected marks that text and keeps the current tool (selection first, as in Acrobat);
    // without a selection it becomes the active tool, and text traced with it is marked
    if (isMarkupTool(next) && annotations && selectionCap && activeDocumentId) {
      if (hasTextSelection(selectionCap, activeDocumentId)) {
        applyTextMarkup(annotations, selectionCap, activeDocumentId, next);
        return;
      }
    }
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
  // A region dragged on empty space with the select tool is kept for Ctrl+C
  useRegionSelection(activeDocumentId, tool === 'select');
  const { copy, paste } = useClipboardActions({ runtime, info, contentSelecting, onStatus: setStatus });
  // Text search (Ctrl+F). focusKey moves the focus back to an already open bar
  const [search, setSearch] = useState<{ open: boolean; focusKey: number }>({ open: false, focusKey: 0 });
  const openSearch = () => setSearch((s) => ({ open: true, focusKey: s.focusKey + 1 }));
  const closeSearch = () => setSearch((s) => ({ ...s, open: false }));
  const canPrint = loaded && (info?.canPrint ?? true);
  const { printing, print } = usePrint({ canPrint, onStatus: setStatus });
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
  const resetDoc = useResetDocument({
    documentId: activeDocumentId,
    entry: recentEntry,
    reopen: openBytes,
    onStatus: setStatus,
  });
  const pagesEditable = loaded && contentEdit !== 'on' && (info?.canModify ?? true) && !isLockedBySignature(info);

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
        <SearchBar
          key={activeDocumentId}
          documentId={activeDocumentId}
          focusKey={search.focusKey}
          onClose={closeSearch}
        />
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
        {opening && <LoadingOverlay opening={opening} />}
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
              canAnnotate={info?.canAnnotate ?? true}
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
