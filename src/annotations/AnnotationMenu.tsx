import { useState } from 'react';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { useAnnotationCapability, type AnnotationSelectionMenuProps } from '@embedpdf/plugin-annotation/react';
import { readTextAnnotation } from './text-ja/text-annotation';
import { requestTextEdit } from './text-ja/edit-requests';
import { readStampAnnotation, requestStampEdit } from './stamps/stamp-annotation';
import { useStampTemplates } from './stamps/template-store';
import { useT } from '../i18n';
import { styleSpec, stylePatch, type AnnotStyle } from './annot-style';
import { ColorSelect, WidthSelect } from './StyleControls';
import { appSettings } from '../app/settings';

/**
 * Small menu shown when an annotation is selected.
 * - Our own text annotations: edit / delete
 * - Our own stamps: edit (rewrite the contents) / delete. Hidden when the template no longer exists
 * - Sticky notes (Text): enter a comment / delete
 * - Shapes / pen / text markup: color (and stroke width) / delete. The pick also becomes the tool default
 * - Everything else: delete
 */
export function AnnotationMenu({
  selected,
  context,
  menuWrapperProps,
  rect,
  documentId,
}: AnnotationSelectionMenuProps & { documentId: string }) {
  const { provides } = useAnnotationCapability();
  const [comment, setComment] = useState<string | null>(null);
  const t = useT();
  const templates = useStampTemplates();
  if (!selected || !provides) return null;

  const annotations = provides.forDocument(documentId);
  const { object } = context.annotation;
  const textData = readTextAnnotation(object);
  const isNote = object.type === PdfAnnotationSubtype.TEXT;
  const stampData = readStampAnnotation(object);
  const stampEditable = !!stampData && templates.some((tpl) => tpl.id === stampData.template);
  const toolId = provides.findToolForAnnotation(object)?.id;
  const spec = styleSpec(toolId);
  // Every tool with a spec creates an annotation type that has these fields (not all union members do)
  const current = object as { strokeColor?: string; strokeWidth?: number };

  const remove = () => annotations.deleteAnnotation(object.pageIndex, object.id);
  // For callouts the origin is the top-left of the text box, not of the rect (the relative position is stored in `custom`)
  const co = textData?.callout;
  const o = object.rect.origin;
  const textRequest = (e: React.MouseEvent) => ({
    annotationId: object.id,
    pageIndex: object.pageIndex,
    origin: co ? { x: o.x + co.box.x, y: o.y + co.box.y } : { x: o.x, y: o.y },
    tip: co ? { x: o.x + co.tip.x, y: o.y + co.tip.y } : undefined,
    anchor: { x: e.clientX, y: e.clientY },
    initialText: textData?.text ?? '',
  });
  const edit = (e: React.MouseEvent) => requestTextEdit(textRequest(e));
  const retarget = (e: React.MouseEvent) => requestTextEdit({ ...textRequest(e), retarget: true });
  const applyStyle = (style: AnnotStyle) => {
    if (!toolId) return;
    annotations.updateAnnotation(object.pageIndex, object.id, stylePatch(toolId, style));
    const saved = appSettings.get().annotStyles;
    const next = { ...saved[toolId], ...style };
    provides.setToolDefaults(toolId, stylePatch(toolId, next));
    appSettings.set({ annotStyles: { ...saved, [toolId]: next } });
  };
  const saveComment = () => {
    if (comment !== null) annotations.updateAnnotation(object.pageIndex, object.id, { contents: comment });
    setComment(null);
  };

  return (
    <div {...menuWrapperProps}>
      <div className="annot-menu" style={{ top: rect.size.height + 8 }}>
        {textData && (
          <button onClick={edit} disabled={context.contentLocked}>
            {t('common.edit')}
          </button>
        )}
        {stampEditable && (
          <button onClick={() => requestStampEdit({ annotationId: object.id })} disabled={context.contentLocked}>
            {t('common.edit')}
          </button>
        )}
        {co && (
          <button onClick={retarget} disabled={context.contentLocked} title={t('annot.retarget.help')}>
            {t('annot.retarget')}
          </button>
        )}
        {isNote && comment === null && (
          <button onClick={() => setComment(object.contents ?? '')} disabled={context.contentLocked}>
            {t('common.comment')}
          </button>
        )}
        {isNote && comment !== null && (
          <span className="annot-comment">
            <textarea
              value={comment}
              rows={3}
              autoFocus
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('common.comment')}
            />
            <button onClick={saveComment}>{t('common.save')}</button>
          </span>
        )}
        {spec && (
          <ColorSelect
            value={current.strokeColor ?? spec.palette[0].hex}
            palette={spec.palette}
            disabled={context.contentLocked}
            onChange={(color) => applyStyle({ color })}
          />
        )}
        {spec?.width && (
          <WidthSelect
            value={current.strokeWidth ?? 1}
            disabled={context.contentLocked}
            onChange={(strokeWidth) => applyStyle({ strokeWidth })}
          />
        )}
        <button onClick={remove} disabled={context.structurallyLocked}>
          {t('common.delete')}
        </button>
      </div>
    </div>
  );
}
