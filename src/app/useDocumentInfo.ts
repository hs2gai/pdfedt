import { useEffect, useState } from 'react';
import type { PdfRuntime } from '../pdf/engine';
import { getDocPtr } from '../pdf/raw';
import { inspectDocument, type DocumentInfo } from '../pdf/inspector';

/** Inspection result of the loaded document (signatures, forms, tags, encryption). null before loading */
export function useDocumentInfo(runtime: PdfRuntime, documentId: string | null, loaded: boolean): DocumentInfo | null {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!documentId || !loaded) return;
    // Wait until EmbedPDF has fully opened the document before inspecting
    const t = setTimeout(() => {
      try {
        setInfo(inspectDocument(runtime.pdfium, getDocPtr(runtime.native, documentId)));
      } catch {
        setInfo(null);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [runtime, documentId, loaded]);
  return info;
}
