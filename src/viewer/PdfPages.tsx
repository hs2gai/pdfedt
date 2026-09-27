import { DocumentContent } from '@embedpdf/plugin-document-manager/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { Scroller } from '@embedpdf/plugin-scroll/react';
import { RenderLayer } from '@embedpdf/plugin-render/react';
import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionLayer } from '@embedpdf/plugin-selection/react';
import { AnnotationLayer } from '@embedpdf/plugin-annotation/react';
import { ZoomGestureWrapper } from '@embedpdf/plugin-zoom/react';
import { TouchGestures } from './TouchGestures';
import { AnnotationMenu } from '../annotations/AnnotationMenu';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfErrorCode } from '@embedpdf/models';
import { frozenFreeTextRenderers } from '../annotations/FrozenFreeText';
import { FormHighlightLayer } from './FormHighlightLayer';
import { t } from '../i18n';

/** Assembles page rendering + text selection + annotation layer */
interface Props {
  documentId: string;
  /** Layer overlaid on each page (e.g. the selection display of content editing mode). scale is the pt → px ratio */
  pageOverlay?: (pageIndex: number, scale: number) => React.ReactNode;
  /** Do not pass pointer events to the annotation layer (while the "Content" tool is active; clicks reach the page handling) */
  annotationsInert?: boolean;
}

export function PdfPages({ documentId, pageOverlay, annotationsInert }: Props) {
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
                      const scale = width / (documentState.document?.pages[pageIndex]?.size.width ?? width);
                      return (
                        <PagePointerProvider
                          documentId={documentId}
                          pageIndex={pageIndex}
                          className="page"
                          style={{ width, height }}
                        >
                          <RenderLayer documentId={documentId} pageIndex={pageIndex} />
                          <SelectionLayer documentId={documentId} pageIndex={pageIndex} />
                          <FormHighlightLayer documentId={documentId} pageIndex={pageIndex} scale={scale} />
                          <AnnotationLayer
                            documentId={documentId}
                            pageIndex={pageIndex}
                            style={annotationsInert ? { pointerEvents: 'none' } : undefined}
                            selectionMenu={(props) => <AnnotationMenu {...props} documentId={documentId} />}
                            annotationRenderers={frozenFreeTextRenderers}
                          />
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
