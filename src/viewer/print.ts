import type { PdfDocumentObject } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';

/** Print resolution. Text stays sharp on paper while a long document still fits in memory */
const PRINT_DPI = 150;
/** Holds the page images while printing; app.css shows only this element in print media */
const CONTAINER_ID = 'print-pages';

/**
 * Prints the document as page images (annotations and form values included, pages turned by their /Rotate).
 * Handing the PDF to the browser's own viewer in an iframe is blocked by the CSP (object-src 'none', no blob: frames)
 * and would print the original without uncommitted state, so each page is rendered and laid out for window.print()
 */
export async function printDocument(
  render: RenderCapability,
  doc: PdfDocumentObject,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  document.getElementById(CONTAINER_ID)?.remove();
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  const urls: string[] = [];
  const cleanup = () => {
    container.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  try {
    const scope = render.forDocument(doc.id);
    for (const page of doc.pages) {
      onProgress(page.index, doc.pageCount);
      const blob = await scope
        .renderPage({
          pageIndex: page.index,
          options: {
            scaleFactor: PRINT_DPI / 72,
            rotation: page.rotation,
            withAnnotations: true,
            withForms: true,
            imageType: 'image/png',
          },
        })
        .toPromise();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      container.append(img);
    }
    onProgress(doc.pageCount, doc.pageCount);
    document.body.append(container);
    await Promise.all([...container.querySelectorAll('img')].map((img) => img.decode()));
  } catch (e) {
    cleanup();
    throw e;
  }
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
