import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfPermissionFlag } from '@embedpdf/models';
import { wasmUtils } from './wasm-utils';
import { saveDocument } from './save';

/**
 * Returns a copy of the PDF protected with an open password (AES-256, via EmbedPDF's EPDF_SetEncryption).
 * Works on a separate document opened from `source`, because the encryption setting sticks to the document
 * and would otherwise also apply to later saves (e.g. the recent-files snapshot).
 * The owner password is the same as the open password and every permission is allowed:
 * permission bits are only honored by some viewers, so only the open password is offered as protection.
 */
export function encryptCopy(
  m: WrappedPdfiumModule,
  source: Uint8Array,
  sourcePassword: string,
  password: string,
): Uint8Array {
  const u = wasmUtils(m);
  return u.withBytes(source, (ptr, len) => {
    const tmp = m.FPDF_LoadMemDocument(ptr, len, sourcePassword);
    if (!tmp) throw new Error('FPDF_LoadMemDocument failed');
    try {
      if (!m.EPDF_SetEncryption(tmp, password, password, PdfPermissionFlag.AllowAll)) {
        throw new Error('EPDF_SetEncryption failed');
      }
      return saveDocument(m, tmp, 'full');
    } finally {
      m.FPDF_CloseDocument(tmp);
    }
  });
}
