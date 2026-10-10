import { refreshPages } from '@embedpdf/core';
import { useRegistry } from '@embedpdf/core/react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { PdfAnnotationSubtype, type Position } from '@embedpdf/models';
import type { PdfRuntime } from '../pdf/engine';
import { getDocPtr, withPage } from '../pdf/raw';
import { loadJaFont } from '../pdf/fonts/ja-font';
import { DEFAULT_FONT_ID, fontLabel, type FontId } from '../pdf/fonts/catalog';
import { guessFontId, isBoldFont } from '../pdf/fonts/match';
import { findLocalFont, isBoldFace, localFontId, subsetLocalFont } from '../pdf/fonts/local-fonts';
import { appSettings } from '../app/settings';
import { hasTrueTypeOutlines } from '../pdf/vertical-pdf';
import { PageObjects, objectKey, type Change, type PageObjectInfo } from './page-objects';
import { contentHistory } from './history';
import { contentEditStore, pickableObjects } from './store';
import { area, contains } from './rect';
import { useT } from '../i18n';

/** The bundled typeface closest to the object's font, and whether that font is bold */
export const similarFont = (o: PageObjectInfo) => (o.font ? guessFontId(o.font.name, o.font.flags) : DEFAULT_FONT_ID);
export const looksBold = (o: PageObjectInfo) => (o.font ? isBoldFont(o.font.name, o.font.weight) : false);

/**
 * The edits of content editing mode on one document: hit testing, and delete / move / replace applied to PDFium
 * right away (the page is regenerated and re-rendered), each pushed onto the content editing history
 */
export function useContentEditOps(runtime: PdfRuntime, documentId: string) {
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  const { registry } = useRegistry();
  const t = useT();

  const pageHeight = (pageIndex: number) => docs?.getDocument(documentId)?.pages[pageIndex]?.size.height ?? 0;
  const withObjects = <T>(pageIndex: number, fn: (po: PageObjects) => T): T =>
    withPage(runtime.native, documentId, pageIndex, (pagePtr) =>
      fn(
        new PageObjects(
          runtime.pdfium,
          getDocPtr(runtime.native, documentId),
          pagePtr,
          pageIndex,
          pageHeight(pageIndex),
        ),
      ),
    );
  const reload = (pageIndex: number) => {
    const list = withObjects(pageIndex, (po) => po.list());
    contentEditStore.set((s) => ({ objects: { ...s.objects, [pageIndex]: list } }));
    return list;
  };
  const ensureObjects = (pageIndex: number) => contentEditStore.get().objects[pageIndex] ?? reload(pageIndex);
  const pickable = (pageIndex: number) =>
    pickableObjects(ensureObjects(pageIndex), contentEditStore.get().showBackground);
  const refresh = (pageIndex: number) => {
    registry?.getStore().dispatchToCore(refreshPages(documentId, [pageIndex]));
    reload(pageIndex);
    contentEditStore.set({ edited: true });
  };
  const selectedObjects = (pageIndex: number, keys: string[]) =>
    ensureObjects(pageIndex).filter((o) => keys.includes(objectKey(o)));
  /** Delete the selected objects (Undo restores them at their original positions) */
  const removeObjects = (pageIndex: number, keys: string[]) => {
    const refs = selectedObjects(pageIndex, keys);
    let change: Change | null = withObjects(pageIndex, (po) => po.remove(refs));
    if (!change) return;
    contentEditStore.set({ selection: null });
    refresh(pageIndex);
    contentHistory.push({
      label: 'delete',
      undo: () => {
        const c = change;
        if (!c) return;
        withObjects(pageIndex, (po) => po.revert(c));
        // The originals are back on the page, so they are no longer ours to destroy
        change = null;
        refresh(pageIndex);
        contentEditStore.set({ selection: { pageIndex, keys } });
      },
      redo: () => {
        change = withObjects(pageIndex, (po) => po.remove(refs));
        contentEditStore.set({ selection: null });
        refresh(pageIndex);
      },
      dispose: () => {
        const c = change;
        if (c) withObjects(pageIndex, (po) => po.discard(c));
      },
    });
  };
  /**
   * Font data to write text in place of object: the typeface chosen in the replace dialog, or by default the original
   * one when it is installed on the PC (and the setting allows it), else a similar bundled one
   */
  const fontFor = async (object: PageObjectInfo, text: string, choice: FontId | 'local' = 'local') => {
    const localFont =
      choice === 'local' && appSettings.get().localFonts && object.font ? findLocalFont(object.font.name) : undefined;
    const similar = similarFont(object);
    const bundled = choice === 'local' ? similar : choice;
    let fontData = localFont ? await subsetLocalFont(localFont, [text]) : (await loadJaFont(bundled)).subsetFor([text]);
    let label = fontLabel(localFont ? localFontId(localFont) : bundled);
    // Vertical text is written with TrueType outlines only; a CFF (OpenType) PC font falls back to a similar bundled one
    if (object.vertical && !hasTrueTypeOutlines(fontData)) {
      fontData = (await loadJaFont(similar)).subsetFor([text]);
      label = fontLabel(similar);
    }
    // No synthetic bold needed when embedding an actual bold face
    const bold = looksBold(object) && !(localFont && isBoldFace(localFont));
    return { fontData, bold, label };
  };
  /**
   * Move the selected objects. Text inside forms cannot leave its form as it is, so it is written again at the new
   * place (PageObjects.rewrite) in the typeface fontFor picks, which the banner then names
   */
  const moveObjects = async (pageIndex: number, keys: string[], dx: number, dy: number) => {
    const objects = selectedObjects(pageIndex, keys);
    const tops = objects.filter((o) => !o.path).map((o) => o.index);
    const nested = objects.filter((o) => o.path && !tops.includes(o.index) && o.text?.trim());
    const items = await Promise.all(
      nested.map(async (o) => ({ ref: o, text: o.text!, dx, dy, ...(await fontFor(o, o.text!)) })),
    );
    let change: Change | null = null;
    const apply = () =>
      withObjects(pageIndex, (po) => {
        if (!po.move(tops, dx, dy)) return false;
        if (!items.length) return true;
        change = po.rewrite(items);
        if (!change) po.move(tops, -dx, -dy);
        return !!change;
      });
    const moved = apply();
    contentEditStore.set({ dragDelta: null });
    if (!moved) return;
    // The rewritten text gets new objects, so its keys no longer hold
    if (items.length) {
      const fonts = [...new Set(items.map((i) => i.label))].join('、');
      contentEditStore.set({ selection: null, notice: t('content.notice.rewritten', { font: fonts }) });
    }
    refresh(pageIndex);
    contentHistory.push({
      label: 'move',
      undo: () => {
        const c = change;
        withObjects(pageIndex, (po) => {
          if (c) po.revert(c);
          po.move(tops, -dx, -dy);
        });
        change = null;
        refresh(pageIndex);
        contentEditStore.set({ selection: { pageIndex, keys } });
      },
      redo: () => {
        apply();
        refresh(pageIndex);
      },
      dispose: () => {
        const c = change;
        if (c) withObjects(pageIndex, (po) => po.discard(c));
      },
    });
  };

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

  /** Replace the text of object with text in the chosen typeface */
  const replaceText = async (pageIndex: number, object: PageObjectInfo, text: string, fontId: FontId | 'local') => {
    const { fontData, bold } = await fontFor(object, text, fontId);
    // Create new objects on every replacement. Keep the original for Undo; Redo recreates them
    let done: Change | null = withObjects(pageIndex, (po) => po.replaceText(object, text, fontData, bold));
    if (!done) return;
    contentEditStore.set({ selection: null });
    refresh(pageIndex);
    contentHistory.push({
      label: 'replace text',
      undo: () => {
        const c = done;
        if (!c) return;
        withObjects(pageIndex, (po) => po.revert(c));
        // The original is back on the page, so it is no longer ours to destroy
        done = null;
        refresh(pageIndex);
      },
      redo: () => {
        done = withObjects(pageIndex, (po) => po.replaceText(object, text, fontData, bold));
        refresh(pageIndex);
      },
      dispose: () => {
        const c = done;
        if (c) withObjects(pageIndex, (po) => po.discard(c));
      },
    });
  };

  return { pickable, hitTest, hitAnnotation, removeObjects, moveObjects, replaceText };
}
