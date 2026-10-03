import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfStampAnnoObject,
} from '@embedpdf/models';
import type { AnnotationScope, TrackedAnnotation } from '@embedpdf/plugin-annotation';
import type { PdfRuntime } from '../pdf/engine';
import { unrotateExportedAppearance } from '../pdf/appearance-matrix';
import { isCopyable, pasteOffset, translateAnnotation, unionRect } from './clipboard-geometry';

/** Each paste onto the same page shifts the copies this far down-right (pt) */
const PASTE_SHIFT = 10;

interface ClipItem {
  annotation: PdfAnnotationObject;
  /** Appearance as a 1-page PDF (stamps and existing FreeText; recreated from it on paste) */
  appearance?: ArrayBuffer;
}

interface Clip {
  documentId: string;
  pageIndex: number;
  /** Resolves once the stamp appearances are exported (Ctrl+V right after Ctrl+C waits for it) */
  items: Promise<ClipItem[]>;
  /** Pastes so far per `${documentId}:${pageIndex}` (the offset grows with each one) */
  pastes: Map<string, number>;
}

/**
 * In-app clipboard for annotations. The system clipboard cannot carry annotations, so they are kept here;
 * it survives switching documents (copy a stamp from one PDF and paste it into another)
 */
let clip: Clip | null = null;

export const clearAnnotationClipboard = () => {
  clip = null;
};

/**
 * Stamps keep their appearance only as /AP, and existing FreeText cannot regenerate it without losing Japanese,
 * so both are copied as their appearance and pasted as a Stamp
 */
const needsAppearance = (a: PdfAnnotationObject) =>
  a.type === PdfAnnotationSubtype.STAMP || a.type === PdfAnnotationSubtype.FREETEXT;

/**
 * Copies the selected annotations into the in-app clipboard.
 * Returns the number of annotations copied (0 when none of the selection can be copied)
 */
export function copyAnnotations(
  runtime: PdfRuntime,
  scope: AnnotationScope,
  doc: PdfDocumentObject,
  selected: TrackedAnnotation[],
): number {
  const objects = selected.map((s) => structuredClone(s.object)).filter(isCopyable);
  if (!objects.length) return 0;
  const items = (async () => {
    // Appearances are exported from PDFium, so the annotations must be written there first
    if (objects.some(needsAppearance)) await scope.commit().toPromise();
    return Promise.all(
      objects.map(async (annotation): Promise<ClipItem> => {
        if (!needsAppearance(annotation)) return { annotation };
        const page = doc.pages[annotation.pageIndex];
        const exported = await runtime.engine.exportAnnotationAppearanceAsPdf(doc, page, annotation).toPromise();
        const pdf = unrotateExportedAppearance(new Uint8Array(exported));
        const appearance = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
        return { annotation, appearance };
      }),
    );
  })();
  // A failed export surfaces on paste; avoid an unhandled rejection here
  items.catch(() => {});
  clip = { documentId: doc.id, pageIndex: objects[0].pageIndex, items, pastes: new Map() };
  return objects.length;
}

export const hasAnnotationClipboard = () => clip !== null;

/**
 * Pastes the in-app clipboard onto `pageIndex`, keeping the relative layout and selecting the copies.
 * On the page copied from, each paste shifts down-right; elsewhere the first paste keeps the same position.
 * Returns the number of annotations pasted
 */
export async function pasteAnnotations(scope: AnnotationScope, doc: PdfDocumentObject, pageIndex: number): Promise<number> {
  const current = clip;
  if (!current) return 0;
  const items = await current.items;
  const page = doc.pages[pageIndex];
  if (!items.length || !page) return 0;

  const key = `${doc.id}:${pageIndex}`;
  const count = current.pastes.get(key) ?? 0;
  current.pastes.set(key, count + 1);
  const samePage = current.documentId === doc.id && current.pageIndex === pageIndex;
  const shift = PASTE_SHIFT * (count + (samePage ? 1 : 0));
  const { dx, dy } = pasteOffset(unionRect(items.map((i) => i.annotation.rect)), page.size, shift);

  const ids = new Map(items.map((i) => [i.annotation.id, uuidV4()]));
  const now = new Date();
  for (const { annotation, appearance } of items) {
    const moved = translateAnnotation(annotation, dx, dy);
    const base = { ...moved, id: ids.get(annotation.id)!, pageIndex, created: now, modified: now };
    // Grouping / replies follow the copy only when the parent was copied too
    const parent = annotation.inReplyToId && ids.get(annotation.inReplyToId);
    if (parent) base.inReplyToId = parent;
    else {
      delete base.inReplyToId;
      delete base.replyType;
    }
    if (!appearance) {
      scope.createAnnotation(pageIndex, base as PdfAnnotationObject);
      continue;
    }
    const stamp: PdfStampAnnoObject =
      annotation.type === PdfAnnotationSubtype.STAMP
        ? (base as PdfStampAnnoObject)
        : {
            type: PdfAnnotationSubtype.STAMP,
            id: base.id,
            pageIndex,
            rect: base.rect,
            flags: base.flags,
            contents: base.contents,
            author: base.author,
            created: now,
            modified: now,
          };
    // The engine may take ownership of the buffer, so hand it a copy (the clipboard can be pasted again)
    scope.createAnnotation(pageIndex, stamp, { data: appearance.slice(0), mimeType: 'application/pdf' });
  }
  scope.setSelection([...ids.values()]);
  return items.length;
}
