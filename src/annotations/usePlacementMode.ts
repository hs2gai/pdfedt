import { useEffect, useRef } from 'react';
import type { Position } from '@embedpdf/models';
import { useInteractionManagerCapability, type EmbedPdfPointerEvent } from '@embedpdf/plugin-interaction-manager/react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';

export interface Placement {
  pageIndex: number;
  /** Page coordinates (pt, top-left origin) */
  origin: Position;
  /** Screen coordinates */
  anchor: { x: number; y: number };
}

/**
 * Shared part of "place something where the page is clicked" tools.
 * Registers a dedicated mode with the interaction manager and captures clicks on every page while active.
 */
export function usePlacementMode(modeId: string, documentId: string, active: boolean, onPlace: (p: Placement) => void) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: docs } = useDocumentManagerCapability();
  const registered = useRef(false);
  const handler = useRef(onPlace);
  handler.current = onPlace;

  // Register the mode only once (re-registering an existing mode throws)
  useEffect(() => {
    if (!interaction || registered.current) return;
    interaction.registerMode({ id: modeId, scope: 'page', exclusive: true, cursor: 'crosshair' });
    registered.current = true;
  }, [interaction, modeId]);

  useEffect(() => {
    if (!active || !interaction || !docs) return;
    const pageCount = docs.getDocument(documentId)?.pageCount ?? 0;
    const scope = interaction.forDocument(documentId);
    const cleanups: (() => void)[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      cleanups.push(
        interaction.registerHandlers({
          documentId,
          modeId,
          pageIndex,
          handlers: {
            onPointerDown: (pos: Position, evt: EmbedPdfPointerEvent) => {
              const native = evt as unknown as { clientX?: number; clientY?: number };
              handler.current({
                pageIndex,
                origin: { x: pos.x, y: pos.y },
                anchor: { x: native.clientX ?? 0, y: native.clientY ?? 0 },
              });
            },
          },
        }),
      );
    }
    scope.activate(modeId);
    return () => {
      cleanups.forEach((fn) => fn());
      // When unmounting after the document was closed, the interaction state is gone too, so leave it alone
      if (docs.getDocument(documentId) && scope.getActiveMode() === modeId) scope.activateDefaultMode();
    };
  }, [active, interaction, docs, documentId, modeId]);
}
