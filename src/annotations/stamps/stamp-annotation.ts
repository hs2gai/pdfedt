import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject, type PdfStampAnnoObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { PdfRuntime } from '../../pdf/engine';
import { buildAppearance } from '../../pdf/appearance';
import { subsetFonts } from '../../pdf/fonts/ja-font';
import {
  templateAppearanceSpec,
  templateTexts,
  templateTextsByFont,
  type StampData,
  type StampTemplate,
} from './template';

/** Returns the contents if this annotation is one of our stamps */
export function readStampAnnotation(annotation: PdfAnnotationObject): StampData | null {
  if (annotation.type !== PdfAnnotationSubtype.STAMP) return null;
  const pdfa = (annotation.custom as { pdfa?: StampData } | undefined)?.pdfa;
  return pdfa?.kind === 'stamp' ? pdfa : null;
}

/**
 * Adds a stamp as a Stamp annotation. The appearance is vector (outline + text in an embedded font).
 * The date and name are rendered and fixed at creation time (no JS like Acrobat's dynamic stamps).
 */
export async function createStampAnnotation(
  runtime: PdfRuntime,
  annotations: AnnotationCapability,
  documentId: string,
  pageIndex: number,
  /** Placement center (pt, top-left origin) */
  center: { x: number; y: number },
  template: StampTemplate,
  data: StampData,
  author?: string,
): Promise<string> {
  const texts = templateTexts(template, data.values);
  const fonts = await subsetFonts(templateTextsByFont(template, data.values));
  const spec = templateAppearanceSpec(template, data.values, data.color, fonts);
  const appearance = buildAppearance(runtime.pdfium, spec);
  const id = uuidV4();
  const annotation: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex,
    rect: {
      origin: { x: center.x - appearance.width / 2, y: center.y - appearance.height / 2 },
      size: { width: appearance.width, height: appearance.height },
    },
    flags: ['print'],
    contents: texts.filter(Boolean).join(' '),
    author,
    created: new Date(),
    modified: new Date(),
    custom: { pdfa: data },
  };
  const pdfBuffer = appearance.pdf.buffer.slice(
    appearance.pdf.byteOffset,
    appearance.pdf.byteOffset + appearance.pdf.byteLength,
  ) as ArrayBuffer;
  annotations
    .forDocument(documentId)
    .createAnnotation(pageIndex, annotation, { data: pdfBuffer, mimeType: 'application/pdf' });
  return id;
}
