import { useState } from 'react';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { useAnnotationCapability, type AnnotationSelectionMenuProps } from '@embedpdf/plugin-annotation/react';
import { readTextAnnotation } from './text-ja/text-annotation';
import { requestTextEdit } from './text-ja/edit-requests';
import { useT } from '../i18n';

/**
 * Small menu shown when an annotation is selected.
 * - Our own text annotations: edit / delete
 * - Sticky notes (Text): enter a comment / delete
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
  if (!selected || !provides) return null;

  const annotations = provides.forDocument(documentId);
  const { object } = context.annotation;
  const textData = readTextAnnotation(object);
  const isNote = object.type === PdfAnnotationSubtype.TEXT;

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
        <button onClick={remove} disabled={context.structurallyLocked}>
          {t('common.delete')}
        </button>
      </div>
    </div>
  );
}
