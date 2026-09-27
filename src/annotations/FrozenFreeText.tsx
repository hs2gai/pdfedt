import { useEffect, useState } from 'react';
import { PdfAnnotationSubtype, type PdfAnnotationObject, type PdfFreeTextAnnoObject } from '@embedpdf/models';
import {
  createRenderer,
  useAnnotationCapability,
  type AnnotationRendererProps,
} from '@embedpdf/plugin-annotation/react';

/**
 * Renders FreeText annotations created by other tools (Acrobat etc.).
 *
 * EmbedPDF's default FreeText regenerates the appearance with Helvetica on every resize or text edit,
 * which drops Japanese characters and paints /C as the background (reproducible with docs/test.pdf).
 * In v1 we keep the original look by "showing the original appearance (/AP) as-is and allowing only move and delete".
 */
function FrozenFreeText({
  annotation,
  documentId,
  pageIndex,
  isSelected,
  onClick,
}: AnnotationRendererProps<PdfFreeTextAnnoObject>) {
  const { provides } = useAnnotationCapability();
  const [src, setSrc] = useState<string | null>(null);
  const object = annotation.object;

  useEffect(() => {
    if (!provides) return;
    let url: string | null = null;
    let cancelled = false;
    provides
      .forDocument(documentId)
      .renderAnnotation({ pageIndex, annotation: object, options: { scaleFactor: 2 } })
      .wait(
        (blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setSrc(url);
        },
        () => setSrc(null),
      );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Moving does not change the appearance (only the position), so drawing once per id is enough
  }, [provides, documentId, pageIndex, object.id]);

  return (
    <div
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        zIndex: 2,
        pointerEvents: !onClick ? 'none' : isSelected ? 'none' : 'auto',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onPointerDown={onClick}
    >
      {src && <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block' }} />}
    </div>
  );
}

const isFreeText = (a: PdfAnnotationObject): a is PdfFreeTextAnnoObject => a.type === PdfAnnotationSubtype.FREETEXT;

/** Passed to AnnotationLayer's annotationRenderers; replaces the default freeText / freeTextCallout */
export const frozenFreeTextRenderers = ['freeText', 'freeTextCallout'].map((id) =>
  createRenderer<PdfFreeTextAnnoObject>({
    id,
    matches: isFreeText,
    render: (props) => <FrozenFreeText {...props} />,
    interactionDefaults: { isDraggable: true, isResizable: false, isRotatable: false },
  }),
);
