import { useEffect } from 'react';
import { uuidV4, type Rect } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { appSettings } from '../app/settings';

/** Text markup tools: they mark the selected text, in the same order as on the toolbar */
export const MARKUP_TOOL_IDS = ['highlight', 'underline', 'strikeout'] as const;
export type MarkupToolId = (typeof MARKUP_TOOL_IDS)[number];

export const isMarkupTool = (id: string): id is MarkupToolId => (MARKUP_TOOL_IDS as readonly string[]).includes(id);

/** A selection rect; text-geometry.ts marks the ones on vertical columns */
type SelectionRect = Rect & { vertical?: boolean };

const bottom = (r: Rect) => r.origin.y + r.size.height;
const centerX = (r: Rect) => r.origin.x + r.size.width / 2;

/**
 * Where the selection menu goes, relative to the top-left of the selection's bounding rect (pt): just below where
 * the selection ends. That is the lowest line, or with vertical text the bottom of the leftmost column (columns run
 * right to left) — the bounding rect instead reaches down to the longest column, usually the first one.
 * Decided by position: the rect order does not always follow the reading order
 */
export function selectionMenuOffset(rects: SelectionRect[], bounding: Rect): { x: number; y: number } {
  if (!rects.length) return { x: 0, y: bounding.size.height };
  const vertical = rects.some((r) => r.vertical);
  const end = rects.reduce((a, b) => {
    if (!vertical) return bottom(b) > bottom(a) ? b : a;
    // Same column when the centers are less than half a column apart; then the lower end wins
    const apart = centerX(a) - centerX(b);
    if (Math.abs(apart) < Math.min(a.size.width, b.size.width) / 2) return bottom(b) > bottom(a) ? b : a;
    return apart > 0 ? b : a;
  });
  return { x: end.origin.x - bounding.origin.x, y: bottom(end) - bounding.origin.y };
}

export const hasTextSelection = (selection: SelectionCapability, documentId: string) =>
  selection.getFormattedSelection(documentId).length > 0;

/**
 * Marks the current text selection with a markup tool and clears the selection.
 * Same annotation as tracing the text with the tool (the plugin's own text markup handler): the tool defaults,
 * which carry the color last picked, plus the selected text in custom.text. Returns false when nothing is selected
 */
export function applyTextMarkup(
  annotations: AnnotationCapability,
  selection: SelectionCapability,
  documentId: string,
  toolId: MarkupToolId,
): boolean {
  const tool = annotations.getTool(toolId);
  const selections = selection.getFormattedSelection(documentId);
  if (!tool || !selections.length) return false;
  const scope = annotations.forDocument(documentId);
  selection
    .forDocument(documentId)
    .getSelectedText()
    .wait(
      (lines) => create(lines.join('\n')),
      () => create(undefined),
    );
  function create(text: string | undefined) {
    for (const s of selections) {
      scope.createAnnotation(s.pageIndex, {
        ...tool!.defaults,
        rect: s.rect,
        segmentRects: s.segmentRects,
        pageIndex: s.pageIndex,
        created: new Date(),
        id: uuidV4(),
        ...(text != null && { custom: { text } }),
      } as Parameters<typeof scope.createAnnotation>[1]);
    }
  }
  selection.forDocument(documentId).clear();
  // The toolbar's marker group shows the kind used last
  appSettings.set({ groupTools: { ...appSettings.get().groupTools, markup: toolId } });
  return true;
}

/**
 * While tracing text with a markup tool, show the selection as the select tool does (the plugin turns it off),
 * so marking text feels like selecting it; the mark is made when the pointer is released
 */
export function useMarkupSelectionRects(
  selection: SelectionCapability | null,
  documentId: string | null,
  loaded: boolean,
) {
  useEffect(() => {
    if (!selection || !documentId || !loaded) return;
    for (const id of MARKUP_TOOL_IDS) {
      selection.enableForMode(
        id,
        { showSelectionRects: true, enableSelection: true, enableMarquee: false },
        documentId,
      );
    }
  }, [selection, documentId, loaded]);
}
