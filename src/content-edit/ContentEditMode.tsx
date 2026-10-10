import { useEffect, useRef, useState } from 'react';
import type { Position } from '@embedpdf/models';
import { useInteractionManagerCapability, type EmbedPdfPointerEvent } from '@embedpdf/plugin-interaction-manager/react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { LockModeType } from '@embedpdf/plugin-annotation';
import { DEFAULT_LOCK } from '../annotations/tools-setup';
import type { PdfRuntime } from '../pdf/engine';
import type { FontId } from '../pdf/fonts/catalog';
import { findLocalFont, type LocalFontData } from '../pdf/fonts/local-fonts';
import { appSettings } from '../app/settings';
import { objectKey, type PageObjectInfo } from './page-objects';
import { contentEditStore, useContentEditState } from './store';
import { TextReplaceDialog } from './TextReplaceDialog';
import { encloses, rectFrom } from './rect';
import { looksBold, similarFont, useContentEditOps } from './useContentEditOps';
import { useT } from '../i18n';

const MODE_ID = 'pdfa-content-edit';
const DRAG_THRESHOLD = 0.5; // pt

interface Props {
  runtime: PdfRuntime;
  documentId: string;
  /** Whether content editing mode is on */
  active: boolean;
  /** Whether the "Content" tool is selected (receives pointer input for content objects; other tools handle annotations normally) */
  selecting: boolean;
  /** When an annotation is clicked with the "Content" tool (select it and switch to the select tool) */
  onPickAnnotation: () => void;
  /** When content is clicked with the select tool (select that object and switch to the "Content" tool) */
  onPickContent: () => void;
}

/**
 * Controls content editing mode. Objects on the page (text, shapes, images) are
 * selected by click / marquee, moved by drag, deleted with Delete, and text is replaced on double-click.
 * Changes are applied to PDFium immediately (GenerateContent) and the page is re-rendered.
 */
export function ContentEditMode({ runtime, documentId, active, selecting, onPickAnnotation, onPickContent }: Props) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  const state = useContentEditState();
  const t = useT();
  const [replaceTarget, setReplaceTarget] = useState<{
    pageIndex: number;
    object: PageObjectInfo;
    anchor: { x: number; y: number };
    /** The same typeface as the original font, if installed on the PC */
    localFont?: LocalFontData;
  } | null>(null);
  const modeRegistered = useRef(false);
  const gesture = useRef<{ kind: 'drag' | 'marquee'; pageIndex: number; start: Position; moved: boolean } | null>(null);
  const ops = useContentEditOps(runtime, documentId);
  const { pickable, hitTest, hitAnnotation, moveObjects, removeObjects } = ops;

  // Register the mode only once
  useEffect(() => {
    if (!interaction || modeRegistered.current) return;
    interaction.registerMode({ id: MODE_ID, scope: 'page', exclusive: true, cursor: 'default' });
    modeRegistered.current = true;
  }, [interaction]);

  // In the select tool (default mode): clicking content where there is no annotation switches to the "Content" tool and selects it
  useEffect(() => {
    if (!active || selecting || !interaction || !docs) return;
    const pageCount = docs.getDocument(documentId)?.pageCount ?? 0;
    const cleanups: (() => void)[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      cleanups.push(
        interaction.registerHandlers({
          documentId,
          modeId: interaction.getDefaultMode(),
          pageIndex,
          handlers: {
            onPointerDown: (pos: Position) => {
              if (hitAnnotation(pageIndex, pos)) return;
              const hit = hitTest(pageIndex, pos);
              if (!hit) return;
              contentEditStore.set({ selection: { pageIndex, keys: [objectKey(hit)] }, notice: null });
              onPickContent();
            },
          },
        }),
      );
    }
    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selecting, interaction, docs, annotations, documentId]);

  // Entering / leaving the "Content" tool: lock annotations and attach pointer handling to every page
  useEffect(() => {
    if (!active || !selecting || !interaction || !docs) return;
    annotations?.setLocked({ type: LockModeType.All }, documentId);
    const pageCount = docs.getDocument(documentId)?.pageCount ?? 0;
    const scope = interaction.forDocument(documentId);
    const cleanups: (() => void)[] = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      cleanups.push(
        interaction.registerHandlers({
          documentId,
          modeId: MODE_ID,
          pageIndex,
          handlers: {
            onPointerDown: (pos: Position, evt: EmbedPdfPointerEvent) => {
              const shift = (evt as unknown as { shiftKey?: boolean }).shiftKey;
              const annot = hitAnnotation(pageIndex, pos);
              if (annot && annotations) {
                // Select the annotation and go to the select tool. Subsequent drag / resize is handled by the annotation plugin
                contentEditStore.set({ selection: null });
                annotations.setLocked(DEFAULT_LOCK, documentId);
                annotations.forDocument(documentId).selectAnnotation(pageIndex, annot.object.id);
                onPickAnnotation();
                return;
              }
              const hit = hitTest(pageIndex, pos);
              const cur = contentEditStore.get().selection;
              const selected = cur?.pageIndex === pageIndex ? cur.keys : [];
              contentEditStore.set({ notice: null });
              if (hit) {
                const key = objectKey(hit);
                let next: string[];
                if (shift) next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
                else next = selected.includes(key) ? selected : [key];
                contentEditStore.set({ selection: { pageIndex, keys: next }, dragDelta: { dx: 0, dy: 0 } });
                gesture.current = { kind: 'drag', pageIndex, start: pos, moved: false };
              } else {
                contentEditStore.set({ selection: null, marquee: { pageIndex, rect: rectFrom(pos, pos) } });
                gesture.current = { kind: 'marquee', pageIndex, start: pos, moved: false };
              }
            },
            onPointerMove: (pos: Position) => {
              const g = gesture.current;
              if (!g || g.pageIndex !== pageIndex) return;
              const dx = pos.x - g.start.x;
              const dy = pos.y - g.start.y;
              if (Math.hypot(dx, dy) > DRAG_THRESHOLD) g.moved = true;
              if (g.kind === 'drag') contentEditStore.set({ dragDelta: { dx, dy } });
              else contentEditStore.set({ marquee: { pageIndex, rect: rectFrom(g.start, pos) } });
            },
            onPointerUp: (pos: Position) => {
              const g = gesture.current;
              gesture.current = null;
              if (!g || g.pageIndex !== pageIndex) return;
              if (g.kind === 'drag') {
                const sel = contentEditStore.get().selection;
                if (g.moved && sel && sel.keys.length) {
                  // The preview stays until the move is done (rewriting text inside forms loads fonts first)
                  void moveObjects(pageIndex, sel.keys, pos.x - g.start.x, pos.y - g.start.y);
                } else {
                  contentEditStore.set({ dragDelta: null });
                }
              } else {
                const box = rectFrom(g.start, pos);
                contentEditStore.set({ marquee: null });
                if (g.moved) {
                  // Only objects entirely inside the box (large objects such as page-wide shapes are not caught by accident)
                  const keys = pickable(pageIndex)
                    .filter((o) => encloses(box, o.rect))
                    .map(objectKey);
                  contentEditStore.set({ selection: keys.length ? { pageIndex, keys } : null });
                }
              }
            },
            onDoubleClick: (pos: Position, evt: EmbedPdfPointerEvent) => {
              const hit = hitTest(pageIndex, pos);
              // Text objects (inside forms too), and forms holding vertical text from an earlier replacement
              if (hit?.type !== 'text' && !hit?.vertical) return;
              const native = evt as unknown as { clientX?: number; clientY?: number };
              const localFont = appSettings.get().localFonts && hit.font ? findLocalFont(hit.font.name) : undefined;
              setReplaceTarget({ pageIndex, object: hit, anchor: { x: native.clientX ?? 0, y: native.clientY ?? 0 }, localFont });
            },
          },
        }),
      );
    }
    scope.activate(MODE_ID);
    return () => {
      cleanups.forEach((fn) => fn());
      // When unmounting after the document was closed, the interaction state is gone too, so leave it alone
      if (docs.getDocument(documentId) && scope.getActiveMode() === MODE_ID) scope.activateDefaultMode();
      if (docs.getDocument(documentId)) annotations?.setLocked(DEFAULT_LOCK, documentId);
      contentEditStore.set({ selection: null, dragDelta: null, marquee: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selecting, interaction, docs, annotations, documentId]);

  // Delete / Backspace deletes the selected objects
  useEffect(() => {
    if (!active || !selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const sel = contentEditStore.get().selection;
      if (!sel?.keys.length) return;
      e.preventDefault();
      removeObjects(sel.pageIndex, sel.keys);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selecting]);

  if (!active) return null;

  const replace = (text: string, fontId: FontId | 'local') => {
    const target = replaceTarget;
    setReplaceTarget(null);
    if (target && text.trim()) void ops.replaceText(target.pageIndex, target.object, text, fontId);
  };

  return (
    <>
      <div className="content-edit-banner">
        {t('content.banner')}
        {selecting ? t('content.banner.selecting') : t('content.banner.otherTool')}
        {selecting && state.selection && t('content.banner.selected', { count: state.selection.keys.length })}
        {state.notice && ` ${state.notice}`}
        {selecting && (
          <label className="content-edit-banner-toggle">
            <input
              type="checkbox"
              checked={state.showBackground}
              onChange={(e) => contentEditStore.set({ showBackground: e.target.checked, selection: null })}
            />
            {t('content.banner.showBackground')}
          </label>
        )}
      </div>
      {replaceTarget && (
        <TextReplaceDialog
          initialText={replaceTarget.object.text ?? ''}
          originalFont={replaceTarget.object.font?.name}
          suggestedFont={similarFont(replaceTarget.object)}
          bold={looksBold(replaceTarget.object)}
          localFont={replaceTarget.localFont?.fullName}
          anchor={replaceTarget.anchor}
          onCommit={replace}
          onCancel={() => setReplaceTarget(null)}
        />
      )}
    </>
  );
}
