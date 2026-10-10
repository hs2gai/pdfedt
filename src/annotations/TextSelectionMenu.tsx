import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useSelectionCapability, type SelectionSelectionMenuProps } from '@embedpdf/plugin-selection/react';
import { IconButton } from './IconButton';
import { MARKUP_TOOL_IDS, applyTextMarkup, selectionMenuOffset } from './text-markup';
import { useT } from '../i18n';

/** Shown under selected text (select tool): mark it as highlight / underline / strikeout in one click, as in Acrobat */
export function TextSelectionMenu({
  menuWrapperProps,
  rect,
  context,
  documentId,
}: SelectionSelectionMenuProps & { documentId: string }) {
  const { provides: annotations } = useAnnotationCapability();
  const { provides: selection } = useSelectionCapability();
  const t = useT();
  if (!annotations || !selection) return null;
  // `rect` is the selection's bounding rect on this page in screen px; the selection works in pt
  const scope = selection.forDocument(documentId);
  const bounding = scope.getBoundingRectForPage(context.pageIndex);
  const scale = bounding && bounding.size.width > 0 ? rect.size.width / bounding.size.width : 1;
  const offset = bounding
    ? selectionMenuOffset(scope.getHighlightRectsForPage(context.pageIndex), bounding)
    : { x: 0, y: rect.size.height / scale };
  return (
    <div {...menuWrapperProps}>
      <div className="annot-menu text-selection-menu" style={{ left: offset.x * scale, top: offset.y * scale + 8 }}>
        {MARKUP_TOOL_IDS.map((id) => (
          <IconButton
            key={id}
            icon={id}
            label={t(`tool.${id}`)}
            // Keep the selection: a pointer down here must not reach the page
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => applyTextMarkup(annotations, selection, documentId, id)}
          />
        ))}
      </div>
    </div>
  );
}
