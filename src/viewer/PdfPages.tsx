import { DocumentContent } from '@embedpdf/plugin-document-manager/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { Scroller } from '@embedpdf/plugin-scroll/react';
import { RenderLayer } from '@embedpdf/plugin-render/react';
import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionLayer } from '@embedpdf/plugin-selection/react';
import { SearchLayer } from '@embedpdf/plugin-search/react';
import { AnnotationLayer } from '@embedpdf/plugin-annotation/react';
import { ZoomGestureWrapper } from '@embedpdf/plugin-zoom/react';
import { TouchGestures } from './TouchGestures';
import { AnnotationMenu } from '../annotations/AnnotationMenu';
import { TextSelectionMenu } from '../annotations/TextSelectionMenu';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfErrorCode } from '@embedpdf/models';
import { frozenFreeTextRenderers } from '../annotations/FrozenFreeText';
import { FormHighlightLayer } from './FormHighlightLayer';
import { RegionLayer } from './RegionSelection';
import { t } from '../i18n';

/** Assembles page rendering + text selection + annotation layer */
interface Props {
  documentId: string;
  /** Layer overlaid on each page (e.g. the selection display of content editing mode). scale is the pt → px ratio */
  pageOverlay?: (pageIndex: number, scale: number) => React.ReactNode;
  /** Do not pass pointer events to the annotation layer (while the "Content" tool is active; clicks reach the page handling) */
  annotationsInert?: boolean;
  /** Annotating is allowed: offer highlight / underline / strikeout on selected text */
  canAnnotate: boolean;
}

/**
 * CSS transform that turns the unrotated page box (width × height px, origin top-left) by `rotation` quarter turns
 * clockwise and puts it back in the rotated slot the Scroller reserves. Rendering, annotations and selection all work
 * in unrotated page coordinates; PagePointerProvider maps pointer positions back through the same rotation
 */
function rotationTransform(rotation: number, width: number, height: number): string | undefined {
  switch (rotation) {
    case 1:
      return `translate(${height}px, 0) rotate(90deg)`;
    case 2:
      return `translate(${width}px, ${height}px) rotate(180deg)`;
    case 3:
      return `translate(0, ${width}px) rotate(270deg)`;
    default:
      return undefined;
  }
}

/** Whether a page image is on screen (the first rendered page of a newly opened document) */
export const isFirstPageRendered = () =>
  [...document.querySelectorAll<HTMLImageElement>('.page img')].some((img) => img.complete && img.naturalWidth > 0);

export function PdfPages({ documentId, pageOverlay, annotationsInert, canAnnotate }: Props) {
  return (
    <DocumentContent documentId={documentId}>
      {({ isLoaded, isError, documentState }) => {
        if (isError && documentState.errorCode === PdfErrorCode.Password) {
          return <PasswordPrompt documentId={documentId} retried={!!documentState.passwordProvided} />;
        }
        if (isError) {
          return (
            <div className="empty">{t('app.openFailed', { error: documentState.error ?? t('app.unknownError') })}</div>
          );
        }
        return (
          isLoaded && (
            <Viewport documentId={documentId} className="viewport">
              {/* Two fingers: pan + pinch zoom (TouchGestures). Ctrl + wheel zoom comes from ZoomGestureWrapper. One finger works the tools */}
              <TouchGestures documentId={documentId}>
                <ZoomGestureWrapper documentId={documentId} enablePinch={false}>
                  <Scroller
                    documentId={documentId}
                    renderPage={({ width, height, pageIndex }) => {
                      const page = documentState.document?.pages[pageIndex];
                      const scale = width / (page?.size.width ?? width);
                      // The page's own /Rotate plus the view rotation (same as PagePointerProvider)
                      const rotation = ((page?.rotation ?? 0) + (documentState.rotation ?? 0)) % 4;
                      const transform = rotationTransform(rotation, width, height);
                      return (
                        <PagePointerProvider
                          documentId={documentId}
                          pageIndex={pageIndex}
                          className="page"
                          style={{ width, height, ...(transform && { transform, transformOrigin: '0 0' }) }}
                        >
                          <RenderLayer documentId={documentId} pageIndex={pageIndex} />
                          <SearchLayer documentId={documentId} pageIndex={pageIndex} scale={scale} className="search-layer" />
                          <SelectionLayer
                            documentId={documentId}
                            pageIndex={pageIndex}
                            selectionMenu={
                              canAnnotate ? (props) => <TextSelectionMenu {...props} documentId={documentId} /> : undefined
                            }
                          />
                          <FormHighlightLayer documentId={documentId} pageIndex={pageIndex} scale={scale} />
                          <AnnotationLayer
                            documentId={documentId}
                            pageIndex={pageIndex}
                            style={annotationsInert ? { pointerEvents: 'none' } : undefined}
                            selectionMenu={(props) => <AnnotationMenu {...props} documentId={documentId} />}
                            annotationRenderers={frozenFreeTextRenderers}
                          />
                          <RegionLayer pageIndex={pageIndex} scale={scale} />
                          {pageOverlay?.(pageIndex, scale)}
                        </PagePointerProvider>
                      );
                    }}
                  />
                </ZoomGestureWrapper>
              </TouchGestures>
            </Viewport>
          )
        );
      }}
    </DocumentContent>
  );
}
