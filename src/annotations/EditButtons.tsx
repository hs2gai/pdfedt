import { useEffect, useState } from 'react';
import { useZoom } from '@embedpdf/plugin-zoom/react';
import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { contentHistory } from '../content-edit/history';
import { useContentEditState } from '../content-edit/store';
import { IconButton } from './IconButton';
import { useT } from '../i18n';

export function ZoomButtons({ documentId }: { documentId: string }) {
  const { state, provides } = useZoom(documentId);
  const t = useT();
  return (
    <>
      <IconButton icon="zoomOut" label={t('toolbar.zoomOut')} onClick={() => provides?.zoomOut()} />
      <span className="zoom">{Math.round(state.currentZoomLevel * 100)}%</span>
      <IconButton icon="zoomIn" label={t('toolbar.zoomIn')} onClick={() => provides?.zoomIn()} />
    </>
  );
}

/** Delete selected annotations, and Undo / Redo */
export function EditButtons({ documentId, contentEdit }: { documentId: string; contentEdit: boolean }) {
  const { state, provides: annotations } = useAnnotation(documentId);
  const { provides: history } = useHistoryCapability();
  const t = useT();
  const [, bump] = useState(0);
  useEffect(() => history?.onHistoryChange(() => bump((n) => n + 1)), [history]);

  // In content editing mode, Undo/Redo target the content editing history
  const { history: ch } = useContentEditState();
  const canUndo = contentEdit ? ch.undo > 0 : !!history?.canUndo();
  const canRedo = contentEdit ? ch.redo > 0 : !!history?.canRedo();
  const undo = () => (contentEdit ? contentHistory.undo() : history?.undo());
  const redo = () => (contentEdit ? contentHistory.redo() : history?.redo());

  const selected = state.selectedUids;
  const deleteSelected = () => {
    if (!annotations) return;
    annotations.deleteAnnotations(
      annotations.getSelectedAnnotations().map((a) => ({ pageIndex: a.object.pageIndex, id: a.object.id })),
    );
  };
  return (
    <>
      <IconButton
        icon="trash"
        label={t('toolbar.delete')}
        title={t('toolbar.delete.help')}
        onClick={deleteSelected}
        disabled={selected.length === 0}
      />
      <IconButton icon="undo" label={t('toolbar.undo')} title="Ctrl+Z" onClick={undo} disabled={!canUndo} />
      <IconButton icon="redo" label={t('toolbar.redo')} title="Ctrl+Y" onClick={redo} disabled={!canRedo} />
    </>
  );
}
