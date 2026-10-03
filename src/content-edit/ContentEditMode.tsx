import { useEffect, useRef, useState } from 'react';
import type { Position, Rect } from '@embedpdf/models';
import { refreshPages } from '@embedpdf/core';
import { useRegistry } from '@embedpdf/core/react';
import { useInteractionManagerCapability, type EmbedPdfPointerEvent } from '@embedpdf/plugin-interaction-manager/react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { LockModeType } from '@embedpdf/plugin-annotation';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { DEFAULT_LOCK } from '../annotations/tools-setup';
import type { PdfRuntime } from '../pdf/engine';
import { getDocPtr, withPage } from '../pdf/raw';
import { loadJaFont } from '../pdf/fonts/ja-font';
import type { FontId } from '../pdf/fonts/catalog';
import { guessFontId, isBoldFont } from '../pdf/fonts/match';
import { findLocalFont, isBoldFace, subsetLocalFont, type LocalFontData } from '../pdf/fonts/local-fonts';
import { appSettings } from '../app/settings';
import { PageObjects, type PageObjectInfo, type RemovedObject } from './page-objects';
import { contentHistory } from './history';
import { contentEditStore, pickableObjects, useContentEditState } from './store';
import { TextReplaceDialog } from './TextReplaceDialog';
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
  const { registry } = useRegistry();
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

  const pageHeight = (pageIndex: number) => docs?.getDocument(documentId)?.pages[pageIndex]?.size.height ?? 0;
  const withObjects = <T,>(pageIndex: number, fn: (po: PageObjects) => T): T =>
    withPage(runtime.native, documentId, pageIndex, (pagePtr) =>
      fn(new PageObjects(runtime.pdfium, getDocPtr(runtime.native, documentId), pagePtr, pageHeight(pageIndex))),
    );
  const reload = (pageIndex: number) => {
    const list = withObjects(pageIndex, (po) => po.list());
    contentEditStore.set((s) => ({ objects: { ...s.objects, [pageIndex]: list } }));
    return list;
  };
  const ensureObjects = (pageIndex: number) => contentEditStore.get().objects[pageIndex] ?? reload(pageIndex);
  const pickable = (pageIndex: number) => pickableObjects(ensureObjects(pageIndex), contentEditStore.get().showBackground);
  const refresh = (pageIndex: number) => {
    registry?.getStore().dispatchToCore(refreshPages(documentId, [pageIndex]));
    reload(pageIndex);
    contentEditStore.set({ edited: true });
  };
  /** Delete the selected objects (Undo restores them at their original positions) */
  const removeObjects = (pageIndex: number, indexes: number[]) => {
    let removed: RemovedObject[] | null = withObjects(pageIndex, (po) => po.remove(indexes));
    if (!removed) return;
    contentEditStore.set({ selection: null });
    refresh(pageIndex);
    contentHistory.push({
      label: 'delete',
      undo: () => {
        withObjects(pageIndex, (po) => po.restore(removed!));
        removed = null;
        refresh(pageIndex);
        contentEditStore.set({ selection: { pageIndex, indexes } });
      },
      redo: () => {
        removed = withObjects(pageIndex, (po) => po.remove(indexes));
        contentEditStore.set({ selection: null });
        refresh(pageIndex);
      },
      dispose: () => {
        if (removed) withObjects(pageIndex, (po) => po.destroy(removed!));
      },
    });
  };

  // Register the mode only once
  useEffect(() => {
    if (!interaction || modeRegistered.current) return;
    interaction.registerMode({ id: MODE_ID, scope: 'page', exclusive: true, cursor: 'default' });
    modeRegistered.current = true;
  }, [interaction]);

  const hitTest = (pageIndex: number, pos: Position) => {
    const hits = pickable(pageIndex).filter((o) => contains(o.rect, pos));
    // Prefer smaller objects (makes it easier to pick foreground text over a large overlapping background)
    return hits.sort((a, b) => area(a.rect) - area(b.rect))[0];
  };
  /** Annotation at the position (excluding form fields). Annotations take priority over content */
  const hitAnnotation = (pageIndex: number, pos: Position) =>
    (annotations?.forDocument(documentId).getAnnotations({ pageIndex }) ?? [])
      .filter((a) => a.object.type !== PdfAnnotationSubtype.WIDGET && contains(a.object.rect, pos))
      .sort((a, b) => area(a.object.rect) - area(b.object.rect))[0];

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
              contentEditStore.set({ selection: { pageIndex, indexes: [hit.index] } });
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
              const selected = cur?.pageIndex === pageIndex ? cur.indexes : [];
              if (hit) {
                let next: number[];
                if (shift)
                  next = selected.includes(hit.index)
                    ? selected.filter((i) => i !== hit.index)
                    : [...selected, hit.index];
                else next = selected.includes(hit.index) ? selected : [hit.index];
                contentEditStore.set({ selection: { pageIndex, indexes: next }, dragDelta: { dx: 0, dy: 0 } });
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
                const dx = pos.x - g.start.x;
                const dy = pos.y - g.start.y;
                contentEditStore.set({ dragDelta: null });
                if (g.moved && sel && sel.indexes.length) {
                  const indexes = sel.indexes;
                  const apply = (sx: number, sy: number) => {
                    withObjects(pageIndex, (po) => po.move(indexes, sx, sy));
                    refresh(pageIndex);
                  };
                  apply(dx, dy);
                  contentHistory.push({
                    label: 'move',
                    undo: () => {
                      apply(-dx, -dy);
                      contentEditStore.set({ selection: { pageIndex, indexes } });
                    },
                    redo: () => apply(dx, dy),
                  });
                }
              } else {
                const box = rectFrom(g.start, pos);
                contentEditStore.set({ marquee: null });
                if (g.moved) {
                  // Only objects entirely inside the box (large objects such as page-wide shapes are not caught by accident)
                  const indexes = pickable(pageIndex)
                    .filter((o) => encloses(box, o.rect))
                    .map((o) => o.index);
                  contentEditStore.set({ selection: indexes.length ? { pageIndex, indexes } : null });
                }
              }
            },
            onDoubleClick: (pos: Position, evt: EmbedPdfPointerEvent) => {
              const hit = hitTest(pageIndex, pos);
              if (hit?.type !== 'text') return;
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
      if (!sel?.indexes.length) return;
      e.preventDefault();
      removeObjects(sel.pageIndex, sel.indexes);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selecting]);

  if (!active) return null;

  const replace = async (text: string, fontId: FontId | 'local') => {
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!target || !text.trim()) return;
    const { pageIndex, object } = target;
    const localFont = fontId === 'local' ? target.localFont : undefined;
    const fontData = localFont
      ? await subsetLocalFont(localFont, [text])
      : (await loadJaFont(fontId === 'local' ? 'gothic' : fontId)).subsetFor([text]); // 'local' only arrives when there is no localFont
    // No synthetic bold needed when embedding an actual bold face
    const bold = object.font ? isBoldFont(object.font.name, object.font.weight) && !(localFont && isBoldFace(localFont)) : false;
    // Create a new object on every replacement. Keep the old one for Undo; Redo recreates it
    let old = withObjects(pageIndex, (po) => po.replaceText(object.index, text, fontData, bold));
    if (!old) return;
    contentEditStore.set({ selection: null });
    refresh(pageIndex);
    contentHistory.push({
      label: 'replace text',
      undo: () => {
        withObjects(pageIndex, (po) => {
          const cur = po.remove([object.index]);
          if (cur) po.destroy(cur);
          po.restore([old!]);
        });
        refresh(pageIndex);
      },
      redo: () => {
        old = withObjects(pageIndex, (po) => po.replaceText(object.index, text, fontData, bold));
        refresh(pageIndex);
      },
      dispose: () => {
        if (old) withObjects(pageIndex, (po) => po.destroy([old!]));
      },
    });
  };

  return (
    <>
      <div className="content-edit-banner">
        {t('content.banner')}
        {selecting ? t('content.banner.selecting') : t('content.banner.otherTool')}
        {selecting && state.selection && t('content.banner.selected', { count: state.selection.indexes.length })}
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
          suggestedFont={
            replaceTarget.object.font ? guessFontId(replaceTarget.object.font.name, replaceTarget.object.font.flags) : 'gothic'
          }
          bold={replaceTarget.object.font ? isBoldFont(replaceTarget.object.font.name, replaceTarget.object.font.weight) : false}
          localFont={replaceTarget.localFont?.fullName}
          anchor={replaceTarget.anchor}
          onCommit={replace}
          onCancel={() => setReplaceTarget(null)}
        />
      )}
    </>
  );
}

const contains = (r: Rect, p: Position) =>
  p.x >= r.origin.x && p.x <= r.origin.x + r.size.width && p.y >= r.origin.y && p.y <= r.origin.y + r.size.height;
const area = (r: Rect) => r.size.width * r.size.height;
/** Whether inner lies entirely within outer */
const encloses = (outer: Rect, inner: Rect) =>
  inner.origin.x >= outer.origin.x &&
  inner.origin.y >= outer.origin.y &&
  inner.origin.x + inner.size.width <= outer.origin.x + outer.size.width &&
  inner.origin.y + inner.size.height <= outer.origin.y + outer.size.height;
const rectFrom = (a: Position, b: Position): Rect => ({
  origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  size: { width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
});
