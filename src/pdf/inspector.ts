import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/** fpdf_formfill.h: FPDF_GetFormType */
const FORMTYPE_NONE = 0;
/** fpdf_annot.h */
const FPDF_ANNOT_WIDGET = 20;
/** fpdf_doc.h: permission bit 3 = print */
const PERM_PRINT = 1 << 2;
/** permission bit 4 = modify contents */
const PERM_MODIFY = 1 << 3;
/** permission bit 6 = add / modify annotations, fill forms */
const PERM_ANNOTATE = 1 << 5;
/** permission bit 9 = fill forms (allowed even without bit 6) */
const PERM_FILL_FORMS = 1 << 8;

export interface DocumentInfo {
  pageCount: number;
  /** Number of digital signatures */
  signatures: number;
  /**
   * Minimum DocMDP permission level (the strictest one when there are several signatures).
   * 1: no changes, 2: form fill and signing only, 3: annotations allowed too, 0: not specified
   */
  docMdp: 0 | 1 | 2 | 3;
  /** Presence of AcroForm / XFA */
  formType: 'none' | 'acroform' | 'xfa';
  /** Number of form fields (Widget annotations) */
  formFields: number;
  /** Tagged PDF (has a structure tree) */
  tagged: boolean;
  encrypted: boolean;
  /** Whether adding annotations is allowed (permission bits of an encrypted document) */
  canAnnotate: boolean;
  /** Whether modifying the content is allowed */
  canModify: boolean;
  /** Whether form filling is allowed (some documents allow filling even when annotations are forbidden) */
  canFillForms: boolean;
  /** Whether printing is allowed */
  canPrint: boolean;
}

/**
 * Inspects the document properties needed to decide the save kind and to gate mode switches.
 * Read-only; the document is not modified.
 */
export function inspectDocument(m: WrappedPdfiumModule, docPtr: number): DocumentInfo {
  const pageCount = m.FPDF_GetPageCount(docPtr);

  const signatures = m.FPDF_GetSignatureCount(docPtr);
  let docMdp: DocumentInfo['docMdp'] = 0;
  for (let i = 0; i < signatures; i++) {
    const sig = m.FPDF_GetSignatureObject(docPtr, i);
    const p = m.FPDFSignatureObj_GetDocMDPPermission(sig);
    if (p >= 1 && p <= 3 && (docMdp === 0 || p < docMdp)) docMdp = p as 1 | 2 | 3;
  }

  const formTypeRaw = m.FPDF_GetFormType(docPtr);
  const formType: DocumentInfo['formType'] =
    formTypeRaw === FORMTYPE_NONE ? 'none' : formTypeRaw === 1 ? 'acroform' : 'xfa';

  let formFields = 0;
  let tagged = false;
  // Stop the tag check after the first few pages so large documents stay fast
  const pagesToProbe = Math.min(pageCount, 5);
  for (let i = 0; i < pageCount; i++) {
    const page = m.FPDF_LoadPage(docPtr, i);
    if (!page) continue;
    try {
      const n = m.FPDFPage_GetAnnotCount(page);
      for (let j = 0; j < n; j++) {
        const annot = m.FPDFPage_GetAnnot(page, j);
        if (m.FPDFAnnot_GetSubtype(annot) === FPDF_ANNOT_WIDGET) formFields++;
        m.FPDFPage_CloseAnnot(annot);
      }
      if (!tagged && i < pagesToProbe) {
        const tree = m.FPDF_StructTree_GetForPage(page);
        if (tree) {
          tagged = m.FPDF_StructTree_CountChildren(tree) > 0;
          m.FPDF_StructTree_Close(tree);
        }
      }
    } finally {
      m.FPDF_ClosePage(page);
    }
  }

  const encrypted = m.EPDF_IsEncrypted(docPtr);
  // Full permissions (0xFFFFFFFF) are returned when the document is not encrypted
  const perms = m.FPDF_GetDocPermissions(docPtr) >>> 0;
  const canAnnotate = (perms & PERM_ANNOTATE) !== 0;
  const canModify = (perms & PERM_MODIFY) !== 0;
  const canFillForms = canAnnotate || (perms & PERM_FILL_FORMS) !== 0;
  const canPrint = (perms & PERM_PRINT) !== 0;

  // Signature fields are Widgets too, so exclude them from the field count
  return {
    pageCount,
    signatures,
    docMdp,
    formType,
    formFields: Math.max(0, formFields - signatures),
    tagged,
    encrypted,
    canAnnotate,
    canModify,
    canFillForms,
    canPrint,
  };
}
