import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfStampAnnoObject,
  type PdfAnnotationObject,
  type Rect,
} from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { PdfRuntime } from '../../pdf/engine';
import { buildCalloutAppearance, buildTextAppearance } from '../../pdf/appearance';
import { loadJaFont } from '../../pdf/fonts/ja-font';
import { DEFAULT_FONT_ID, type FontId } from '../../pdf/fonts/catalog';

/** Visual style of a text annotation. Stored in the annotation's custom.pdfa so it can be re-edited */
export interface TextStyle {
  fontSize: number;
  /** 0–255 */
  color: { r: number; g: number; b: number };
  /** Typeface (missing in old annotations → gothic) */
  font?: FontId;
  /** Vertical writing: lines become columns running right to left */
  vertical?: boolean;
}

export interface TextAnnotationData extends TextStyle {
  kind: 'text';
  text: string;
  /**
   * For callouts. Relative to the top-left of the annotation rect (pt, y pointing down):
   * box = top-left of the text box, tip = arrow tip. Dragging the annotation does not change the relative position
   */
  callout?: { box: { x: number; y: number }; tip: { x: number; y: number } };
}

export const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 11, color: { r: 0, g: 0, b: 0 }, font: DEFAULT_FONT_ID };

/** Returns the contents if this annotation is one of our text annotations */
export function readTextAnnotation(annotation: PdfAnnotationObject): TextAnnotationData | null {
  if (annotation.type !== PdfAnnotationSubtype.STAMP) return null;
  const pdfa = (annotation.custom as { pdfa?: TextAnnotationData } | undefined)?.pdfa;
  return pdfa?.kind === 'text' ? pdfa : null;
}

/**
 * Adds Japanese text as a Stamp annotation.
 * The appearance is generated as a 1-page PDF with an embedded font and created through the annotation plugin
 * (tracking, selection, moving and Undo are left to the plugin).
 */
export async function createTextAnnotation(
  runtime: PdfRuntime,
  annotations: AnnotationCapability,
  documentId: string,
  pageIndex: number,
  /** Top-left of the text box (pt, top-left origin) */
  origin: { x: number; y: number },
  data: Omit<TextAnnotationData, 'kind' | 'callout'>,
  /** Arrow tip when adding a callout (pt, top-left origin) */
  tip?: { x: number; y: number },
  author?: string,
): Promise<string> {
  const font = await loadJaFont(data.font ?? DEFAULT_FONT_ID);
  const textSpec = {
    text: data.text,
    fontSize: data.fontSize,
    color: data.color,
    vertical: data.vertical,
    fontData: font.subsetFor([data.text]),
  };
  let rect: Rect;
  let appearance;
  let callout: TextAnnotationData['callout'];
  if (tip) {
    const a = buildCalloutAppearance(runtime.pdfium, { ...textSpec, tip: { x: tip.x - origin.x, y: tip.y - origin.y } });
    appearance = a;
    const rectOrigin = { x: origin.x - a.box.x, y: origin.y - a.box.y };
    rect = { origin: rectOrigin, size: { width: a.width, height: a.height } };
    callout = { box: a.box, tip: { x: tip.x - rectOrigin.x, y: tip.y - rectOrigin.y } };
  } else {
    appearance = buildTextAppearance(runtime.pdfium, textSpec);
    rect = { origin, size: { width: appearance.width, height: appearance.height } };
  }
  const id = uuidV4();
  const annotation: PdfStampAnnoObject = {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex,
    rect,
    flags: ['print'],
    contents: data.text,
    author,
    created: new Date(),
    modified: new Date(),
    custom: {
      pdfa: {
        kind: 'text',
        text: data.text,
        fontSize: data.fontSize,
        color: data.color,
        font: data.font,
        vertical: data.vertical,
        callout,
      },
    },
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
