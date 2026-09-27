import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { ZoomPluginPackage, ZoomMode } from '@embedpdf/plugin-zoom/react';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/react';
import { FormPluginPackage } from '@embedpdf/plugin-form/react';
import type { PdfRuntime } from '../pdf/engine';
import { EditorShell } from './EditorShell';
import { DEFAULT_LOCK } from '../annotations/tools-setup';

// Register in dependency order (interaction-manager / selection / history → annotation)
const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
  createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
  createPluginRegistration(ThumbnailPluginPackage, { width: 110, gap: 10, labelHeight: 18, paddingY: 8 }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(SelectionPluginPackage),
  createPluginRegistration(HistoryPluginPackage),
  // AcroForm filling (draws form widgets inside the annotation layer)
  createPluginRegistration(FormPluginPackage),
  createPluginRegistration(AnnotationPluginPackage, {
    // Write created annotations to PDFium immediately (no missed commit at save time)
    autoCommit: true,
    locked: DEFAULT_LOCK,
    selectAfterCreate: true,
    deactivateToolAfterCreate: false,
    // Existing FreeText cannot regenerate its appearance (Japanese would disappear), so block resize / rotate / text edit
    tools: [
      { id: 'freeText', interaction: { exclusive: false, isResizable: false, isRotatable: false } },
      { id: 'freeTextCallout', interaction: { exclusive: false, isResizable: false, isRotatable: false } },
    ],
  }),
];

export function Editor({ runtime }: { runtime: PdfRuntime }) {
  return (
    <EmbedPDF engine={runtime.engine} plugins={plugins}>
      <EditorShell runtime={runtime} />
    </EmbedPDF>
  );
}
