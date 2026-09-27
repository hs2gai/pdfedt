import { useEffect, useState } from 'react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import type { PdfRuntime } from '../../pdf/engine';
import { usePlacementMode } from '../usePlacementMode';
import { createTextAnnotation, readTextAnnotation, DEFAULT_TEXT_STYLE, type TextStyle } from './text-annotation';
import { TextEditorPopover, type TextEditorRequest } from './TextEditorPopover';
import { onTextEditRequest, type EditTextRequest } from './edit-requests';
import { t } from '../../i18n';

const MODE_ID = 'pdfa-text-ja';

interface Props {
  runtime: PdfRuntime;
  documentId: string;
  active: boolean;
  /** Callout (placed with 2 clicks: arrow tip → text position) */
  callout: boolean;
  /** Return to the select tool after placing one annotation */
  onDone: () => void;
}

type Request = TextEditorRequest & { annotationId?: string };

/**
 * The "Text" and "Callout" tools. Shows the input popover at the clicked page position and,
 * on confirm, writes a Stamp annotation with an embedded font.
 */
export function TextJaTool({ runtime, documentId, active, callout, onDone }: Props) {
  const { provides: annotations } = useAnnotationCapability();
  const [request, setRequest] = useState<Request | null>(null);
  const [style, setStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);
  /** Callout: remember the first click (arrow tip) */
  const [tip, setTip] = useState<{ pageIndex: number; x: number; y: number } | null>(null);
  /** Request to move the arrow tip of an existing annotation */
  const [retarget, setRetarget] = useState<EditTextRequest | null>(null);

  usePlacementMode(MODE_ID, documentId, active || !!retarget, (p) => {
    if (retarget) {
      setRetarget(null);
      if (p.pageIndex !== retarget.pageIndex) return;
      void recreate(retarget, retarget.initialText, styleOf(retarget.annotationId), p.origin);
      return;
    }
    if (!callout) return setRequest({ ...p, initialText: '' });
    if (!tip || tip.pageIndex !== p.pageIndex) {
      setTip({ pageIndex: p.pageIndex, ...p.origin });
      return;
    }
    setRequest({ ...p, initialText: '', tip: { x: tip.x, y: tip.y } });
    setTip(null);
  });

  // Drop in-progress state when leaving the tool. Moving the arrow tip is cancelled with Esc
  useEffect(() => {
    if (!active) setTip(null);
  }, [active]);
  useEffect(() => {
    if (!retarget) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRetarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [retarget]);

  // Receive requests from "Edit" / "Move arrow tip" in the selection menu
  useEffect(
    () =>
      onTextEditRequest((req: EditTextRequest) => {
        if (req.retarget) setRetarget(req);
        else setRequest(req);
      }),
    [],
  );

  const styleOf = (annotationId?: string): TextStyle => {
    const existing = annotationId
      ? annotations?.forDocument(documentId).getAnnotationById(annotationId)?.object
      : undefined;
    const data = existing ? readTextAnnotation(existing) : null;
    return data ? { fontSize: data.fontSize, color: data.color, font: data.font } : style;
  };

  /** Editing an existing annotation means "delete and recreate at the same position" (the appearance PDF must be regenerated) */
  const recreate = async (req: Request, text: string, nextStyle: TextStyle, newTip?: { x: number; y: number }) => {
    if (!annotations) return;
    if (req.annotationId) annotations.forDocument(documentId).deleteAnnotation(req.pageIndex, req.annotationId);
    await createTextAnnotation(runtime, annotations, documentId, req.pageIndex, req.origin, { text, ...nextStyle }, newTip ?? req.tip);
  };

  const commit = async (text: string, nextStyle: TextStyle) => {
    setStyle(nextStyle);
    setRequest(null);
    if (!request || !text.trim()) return;
    await recreate(request, text, nextStyle);
    if (!request.annotationId) onDone();
  };

  if (retarget) return <div className="tool-hint">{t('text.retargetHint')}</div>;
  if (!request) {
    if (active && callout) {
      return (
        <div className="tool-hint">
          {tip ? t('text.calloutStep2') : t('text.calloutStep1')}
          {t('text.escHint')}
        </div>
      );
    }
    return null;
  }

  return (
    <TextEditorPopover
      key={request.annotationId ?? 'new'}
      request={request}
      style={styleOf(request.annotationId)}
      onCommit={commit}
      onCancel={() => setRequest(null)}
    />
  );
}
