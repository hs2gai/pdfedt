import { PdfAnnotationSubtype, type PdfAnnotationObject, type PdfStampAnnoObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';

/** The plugin takes appearances as an ArrayBuffer of their own (a view may sit inside a larger buffer) */
export const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Our data in custom.pdfa of a Stamp annotation, when its kind matches */
export function readPdfa<T extends { kind: string }>(annotation: PdfAnnotationObject, kind: T['kind']): T | null {
  if (annotation.type !== PdfAnnotationSubtype.STAMP) return null;
  const pdfa = (annotation.custom as { pdfa?: T } | undefined)?.pdfa;
  return pdfa?.kind === kind ? pdfa : null;
}

/** Adds a Stamp annotation whose appearance is the given 1-page PDF */
export function addAppearanceAnnotation(
  annotations: AnnotationCapability,
  documentId: string,
  annotation: PdfStampAnnoObject,
  pdf: Uint8Array,
) {
  annotations
    .forDocument(documentId)
    .createAnnotation(annotation.pageIndex, annotation, { data: toArrayBuffer(pdf), mimeType: 'application/pdf' });
}
