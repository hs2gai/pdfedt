import type { PdfRuntime } from '../engine';
import { withPage } from '../raw';
import { wasmUtils } from '../wasm-utils';

/** fpdf_edit.h: FPDF_PAGEOBJ_* */
const OBJ_TYPES = ['unknown', 'text', 'path', 'image', 'shading', 'form'] as const;

interface PageObj {
  index: number;
  type: string;
  bounds: { left: number; bottom: number; right: number; top: number };
}

/** Enumerate the type and bounds of every object on the page */
export function listPageObjects(rt: PdfRuntime, docId: string, pageIndex: number): PageObj[] {
  const m = rt.pdfium;
  const u = wasmUtils(m);
  return withPage(rt.native, docId, pageIndex, (pagePtr) => {
    const n = m.FPDFPage_CountObjects(pagePtr);
    const out: PageObj[] = [];
    const buf = u.malloc(16);
    try {
      for (let i = 0; i < n; i++) {
        const obj = m.FPDFPage_GetObject(pagePtr, i);
        const type = OBJ_TYPES[m.FPDFPageObj_GetType(obj)] ?? 'unknown';
        // FPDFPageObj_GetBounds(obj, &left, &bottom, &right, &top)
        m.FPDFPageObj_GetBounds(obj, buf, buf + 4, buf + 8, buf + 12);
        const f = (o: number) => m.pdfium.getValue(buf + o, 'float');
        out.push({ index: i, type, bounds: { left: f(0), bottom: f(4), right: f(8), top: f(12) } });
      }
    } finally {
      u.free(buf);
    }
    return out;
  });
}

/** Return the index of the topmost object containing point (x, y) (pt, bottom-left origin) */
export function hitTestObject(objs: PageObj[], x: number, y: number): PageObj | undefined {
  return [...objs]
    .reverse()
    .find((o) => x >= o.bounds.left && x <= o.bounds.right && y >= o.bounds.bottom && y <= o.bounds.top);
}

/**
 * S6: delete or move an object.
 * Both rewrite the page content, so FPDFPage_GenerateContent is required (content editing mode only).
 */
export function removeObject(rt: PdfRuntime, docId: string, pageIndex: number, objIndex: number): boolean {
  const m = rt.pdfium;
  return withPage(rt.native, docId, pageIndex, (pagePtr) => {
    const obj = m.FPDFPage_GetObject(pagePtr, objIndex);
    if (!obj || !m.FPDFPage_RemoveObject(pagePtr, obj)) return false;
    m.FPDFPageObj_Destroy(obj); // After RemoveObject, ownership returns to the caller
    return !!m.FPDFPage_GenerateContent(pagePtr);
  });
}

export function moveObject(
  rt: PdfRuntime,
  docId: string,
  pageIndex: number,
  objIndex: number,
  dx: number,
  dy: number,
): boolean {
  const m = rt.pdfium;
  return withPage(rt.native, docId, pageIndex, (pagePtr) => {
    const obj = m.FPDFPage_GetObject(pagePtr, objIndex);
    if (!obj) return false;
    m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, dx, dy);
    return !!m.FPDFPage_GenerateContent(pagePtr);
  });
}
