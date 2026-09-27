import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { readTextAnnotation } from './text-ja/text-annotation';
import { readStampAnnotation } from './stamps/stamp-annotation';

import { LockModeType, type LockMode } from '@embedpdf/plugin-annotation';

export const TEXT_JA_TOOL_ID = 'textJa';
export const STAMP_JA_TOOL_ID = 'stampJa';

/**
 * Default lock: form widgets are not selectable / movable as annotations;
 * they behave as input fields (the form plugin's fill mode).
 */
export const DEFAULT_LOCK: LockMode = { type: LockModeType.Include, categories: ['form'] };

/**
 * Tunes the annotation plugin's default tools for Japanese business documents and registers our own text annotation tools.
 * The default 6pt stroke is too thick, so use 1.5pt; ink uses 2pt.
 */
export function configureAnnotationTools(annotations: AnnotationCapability) {
  // P5: make every annotation printable (some default tools do not set Print in /F)
  for (const tool of annotations.getTools()) {
    annotations.setToolDefaults(tool.id, { flags: ['print'] });
  }
  for (const id of ['square', 'circle', 'line', 'lineArrow']) {
    annotations.setToolDefaults(id, { strokeWidth: 1.5 });
  }
  annotations.setToolDefaults('ink', { strokeWidth: 2 });

  if (!annotations.getTool(STAMP_JA_TOOL_ID)) {
    annotations.addTool({
      id: STAMP_JA_TOOL_ID,
      name: 'Stamp',
      matchScore: (a) => (readStampAnnotation(a) ? 100 : 0),
      defaults: { type: PdfAnnotationSubtype.STAMP },
      // The appearance is vector, so scaling does not degrade it. Only lock the aspect ratio
      interaction: { exclusive: false, isResizable: true, lockAspectRatio: true, isRotatable: true, isDraggable: true },
    });
  }
  if (!annotations.getTool(TEXT_JA_TOOL_ID)) {
    annotations.addTool({
      id: TEXT_JA_TOOL_ID,
      name: 'Text',
      // Match our own text annotations (Stamps with custom.pdfa.kind === 'text') with top priority
      matchScore: (a) => (readTextAnnotation(a) ? 100 : 0),
      defaults: { type: PdfAnnotationSubtype.STAMP },
      // The appearance is generated for the font size, so do not stretch it on resize / rotate
      interaction: { exclusive: false, isResizable: false, isRotatable: false, isDraggable: true },
    });
  }
}
