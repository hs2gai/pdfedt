import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { wasmUtils } from './wasm-utils';

/** fpdf_save.h */
const FPDF_INCREMENTAL = 1;
const FPDF_NO_INCREMENTAL = 2;

export type SaveMode = 'incremental' | 'full';

/**
 * Serializes the document to bytes.
 * - incremental: append the changes after the original bytes (original unchanged, signatures kept)
 * - full: rewrite the whole file (removes leftovers of deleted annotations / after content editing)
 */
export function saveDocument(m: WrappedPdfiumModule, docPtr: number, mode: SaveMode): Uint8Array {
  const u = wasmUtils(m);
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    const flags = mode === 'incremental' ? FPDF_INCREMENTAL : FPDF_NO_INCREMENTAL;
    if (!m.FPDF_SaveWithVersion(docPtr, writer, flags, 17)) throw new Error('FPDF_SaveWithVersion failed');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const buf = u.malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, buf, size);
      return u.readBytes(buf, size);
    } finally {
      u.free(buf);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}
