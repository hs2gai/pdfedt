import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ThumbnailsPane, ThumbImg } from '@embedpdf/plugin-thumbnail/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import type { ThumbMeta } from '@embedpdf/plugin-thumbnail';
import { useAppSettings } from '../app/settings';
import { t } from '../i18n';

const PAGE_DRAG_TYPE = 'application/x-pdfugu-page';

interface Props {
  documentId: string;
  pageCount: number;
  /** Page structure operations. When omitted (e.g. signature-locked), display only */
  onDeletePage?: (index: number) => void;
  onMovePage?: (from: number, to: number) => void;
  onImportPdf?: (file: File, insertIndex: number) => void;
}

/**
 * Page thumbnail list. Click to go to that page.
 * Select and press Delete to remove, drag to reorder, drop a PDF file to insert it at that position.
 */
export function ThumbnailSidebar({ documentId, pageCount, onDeletePage, onMovePage, onImportPdf }: Props) {
  const { provides: scroll, state } = useScroll(documentId);
  // In long documents the animation feels like waiting, so it can be turned off in settings (off by default)
  const { smoothScroll } = useAppSettings();
  const [selected, setSelected] = useState<number | null>(null);
  /** Drop target (before the page at this index; pageCount means the end) */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const aside = useRef<HTMLElement>(null);
  const editable = !!(onDeletePage && onMovePage && onImportPdf);

  const select = (index: number) => {
    setSelected(index);
    aside.current?.focus();
    scroll?.scrollToPage({ pageNumber: index + 1, behavior: smoothScroll ? 'smooth' : 'instant' });
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null && onDeletePage) {
      e.preventDefault();
      onDeletePage(selected);
      setSelected(null);
    }
  };

  // --- Drag (reorder pages / add a PDF) ---
  const dragKind = (e: DragEvent) =>
    e.dataTransfer.types.includes(PAGE_DRAG_TYPE) ? 'page' : e.dataTransfer.types.includes('Files') ? 'file' : null;
  const dragOverThumb = (e: DragEvent, index: number) => {
    if (!editable || !dragKind(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1);
  };
  const dragOverPane = (e: DragEvent) => {
    if (!editable || !dragKind(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target === e.currentTarget) setDropAt(pageCount); // outside the thumbnails (the end)
  };
  const drop = (e: DragEvent) => {
    const kind = dragKind(e);
    if (!editable || !kind) return;
    e.preventDefault();
    e.stopPropagation(); // do not pass to the app-wide "open" drop
    const to = dropAt ?? pageCount;
    setDropAt(null);
    if (kind === 'page') {
      const from = Number(e.dataTransfer.getData(PAGE_DRAG_TYPE));
      if (Number.isInteger(from)) onMovePage!(from, to);
    } else {
      const file = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (file) onImportPdf!(file, to);
    }
  };

  return (
    <aside
      ref={aside}
      className="thumbs"
      tabIndex={0}
      onKeyDown={onKey}
      onDragOver={dragOverPane}
      onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}
      onDrop={drop}
      title={editable ? t('thumbs.help') : undefined}
    >
      <ThumbnailsPane documentId={documentId} className="thumbs-pane">
        {(m: ThumbMeta) => (
          <div
            key={m.pageIndex}
            className={`thumb${state.currentPage === m.pageIndex + 1 ? ' current' : ''}${selected === m.pageIndex ? ' selected' : ''}`}
            style={{ position: 'absolute', top: m.top, height: m.wrapperHeight, width: '100%' }}
            onClick={() => select(m.pageIndex)}
            draggable={editable}
            onDragStart={(e) => {
              e.dataTransfer.setData(PAGE_DRAG_TYPE, String(m.pageIndex));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => dragOverThumb(e, m.pageIndex)}
            onDragEnd={() => setDropAt(null)}
          >
            {dropAt === m.pageIndex && <div className="thumb-drop-line top" />}
            {dropAt === m.pageIndex + 1 && <div className="thumb-drop-line bottom" />}
            <ThumbImg
              documentId={documentId}
              meta={m}
              className="thumb-img"
              style={{ width: m.width, height: m.height }}
            />
            <div className="thumb-label" style={{ height: m.labelHeight }}>
              {m.pageIndex + 1}
            </div>
          </div>
        )}
      </ThumbnailsPane>
    </aside>
  );
}
