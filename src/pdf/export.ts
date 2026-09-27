import type { PdfRuntime } from './engine';
import { getDocPtr } from './raw';
import { saveDocument } from './save';
import { flattenCopy } from './flatten';
import { encryptCopy } from './encrypt';
import { IncrementalSaver } from './incremental';

export type ExportKind = 'incremental' | 'full' | 'flatten';

/** Incremental saver per open document (keeps the original bytes and the baseline) */
const savers = new Map<string, IncrementalSaver>();
/** Open password per document (memory only, never stored). Needed to reopen encrypted copies */
const passwords = new Map<string, string>();

/** Call right after opening the document to record the original bytes and the baseline increment */
export function registerOpenedDocument(runtime: PdfRuntime, documentId: string, original: Uint8Array) {
  const saver = new IncrementalSaver(runtime.pdfium, original);
  saver.captureBaseline(getDocPtr(runtime.native, documentId));
  savers.set(documentId, saver);
}

/** Remember the password used to open the document (a wrong one is simply overwritten by the next try) */
export function rememberPassword(documentId: string, password: string) {
  passwords.set(documentId, password);
}

/** The open password of the document ('' when it was opened without one) */
export function openPasswordOf(documentId: string): string {
  return passwords.get(documentId) ?? '';
}

export function forgetDocument(documentId: string) {
  savers.delete(documentId);
  passwords.delete(documentId);
}

/**
 * Export. The caller must commit annotations beforehand.
 * Encrypted documents keep their open password in every kind.
 * `newPassword` protects the result with a (new) open password; not possible with incremental saves,
 * because encryption applies to the whole file.
 */
export function exportDocument(
  runtime: PdfRuntime,
  documentId: string,
  kind: ExportKind,
  newPassword?: string,
): Uint8Array {
  const m = runtime.pdfium;
  const docPtr = getDocPtr(runtime.native, documentId);
  const password = openPasswordOf(documentId);
  if (newPassword !== undefined) {
    if (kind === 'incremental') throw new Error('A password cannot be set on an incremental save');
    const bytes = kind === 'flatten' ? flattenCopy(m, docPtr, password) : saveDocument(m, docPtr, 'full');
    return encryptCopy(m, bytes, password, newPassword);
  }
  switch (kind) {
    case 'flatten':
      return flattenCopy(m, docPtr, password);
    case 'full':
      return saveDocument(m, docPtr, 'full');
    case 'incremental': {
      const saver = savers.get(documentId);
      return saver ? saver.save(docPtr) : saveDocument(m, docPtr, 'incremental');
    }
  }
}
