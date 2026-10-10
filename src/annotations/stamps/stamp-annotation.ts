import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject, type PdfStampAnnoObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { PdfRuntime } from '../../pdf/engine';
import { channel } from '../../shared/channel';
import { addAppearanceAnnotation, readPdfa } from '../appearance-annotation';
import { stampRects, type StampPlacement } from './geometry';
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
export const readStampAnnotation = (annotation: PdfAnnotationObject) => readPdfa<StampData>(annotation, 'stamp');

/** "Edit" in the selection menu → the stamp panel (regenerates the stamp with new contents) */
const stampEdits = channel<{ annotationId: string }>();
export const requestStampEdit = stampEdits.emit;
export const onStampEditRequest = stampEdits.on;

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
  /** Size / rotation to keep when regenerating an edited stamp */
  placement?: StampPlacement,
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
    ...stampRects(center, appearance, placement),
    flags: ['print'],
    contents: texts.filter(Boolean).join(' '),
    author,
    created: new Date(),
    modified: new Date(),
    custom: { pdfa: data },
  };
  addAppearanceAnnotation(annotations, documentId, annotation, appearance.pdf);
  return id;
}
