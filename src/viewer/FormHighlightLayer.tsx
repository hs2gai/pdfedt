import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import { PdfAnnotationSubtype, PDF_FORM_FIELD_TYPE, type PdfWidgetAnnoObject } from '@embedpdf/models';
import { useAppSettings } from '../app/settings';

/**
 * Shows form fields in light blue (like Acrobat's "Highlight fields").
 * Placed under the annotation layer, so field borders and text are drawn on top of it.
 */
export function FormHighlightLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { highlightFields } = useAppSettings();
  const { state } = useAnnotation(documentId);
  if (!highlightFields) return null;
  const widgets = (state.pages[pageIndex] ?? [])
    .map((uid) => state.byUid[uid]?.object)
    .filter((o): o is PdfWidgetAnnoObject => o?.type === PdfAnnotationSubtype.WIDGET)
    // Push buttons and signature fields are not input fields, so they are not painted
    .filter((o) => o.field.type !== PDF_FORM_FIELD_TYPE.PUSHBUTTON && o.field.type !== PDF_FORM_FIELD_TYPE.SIGNATURE);
  if (widgets.length === 0) return null;
  return (
    <div className="form-highlight">
      {widgets.map((o) => (
        <div
          key={o.id}
          style={{
            left: o.rect.origin.x * scale,
            top: o.rect.origin.y * scale,
            width: o.rect.size.width * scale,
            height: o.rect.size.height * scale,
          }}
        />
      ))}
    </div>
  );
}
