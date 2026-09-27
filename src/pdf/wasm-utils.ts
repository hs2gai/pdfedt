import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/** Small helpers for the WASM memory operations needed by raw PDFium calls */
export function wasmUtils(m: WrappedPdfiumModule) {
  const rt = m.pdfium;
  const malloc = (n: number) => rt.wasmExports.malloc(n) as number;
  const free = (p: number) => rt.wasmExports.free(p);
  return {
    malloc,
    free,
    /** Allocate a FPDF_WIDESTRING (UTF-16LE + NUL) and pass it to fn */
    withWide<T>(s: string, fn: (ptr: number) => T): T {
      const len = (s.length + 1) * 2;
      const p = malloc(len);
      try {
        rt.stringToUTF16(s, p, len);
        return fn(p);
      } finally {
        free(p);
      }
    },
    /** Copy bytes into the WASM heap and pass them to fn */
    withBytes<T>(bytes: Uint8Array, fn: (ptr: number, len: number) => T): T {
      const p = malloc(bytes.byteLength);
      try {
        rt.HEAPU8.set(bytes, p);
        return fn(p, bytes.byteLength);
      } finally {
        free(p);
      }
    },
    /** Allocate an FS_RECTF {left, top, right, bottom} and pass it to fn */
    withRectF<T>(r: { left: number; top: number; right: number; bottom: number }, fn: (ptr: number) => T): T {
      const p = malloc(16);
      try {
        rt.setValue(p, r.left, 'float');
        rt.setValue(p + 4, r.top, 'float');
        rt.setValue(p + 8, r.right, 'float');
        rt.setValue(p + 12, r.bottom, 'float');
        return fn(p);
      } finally {
        free(p);
      }
    },
    /** Copy from the WASM heap to the JS side */
    readBytes(ptr: number, len: number): Uint8Array {
      return rt.HEAPU8.slice(ptr, ptr + len);
    },
  };
}
