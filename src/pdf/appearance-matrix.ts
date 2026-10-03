/** Key EmbedPDF puts on the wrapper form it adds to the appearance of an annotation rotated in the viewer */
const WRAPPER_MARK = '/EPDFOrigContentRect';

/** Bytes as a 1:1 string (TextDecoder's 'latin1' is windows-1252 and remaps 0x80–0x9F) */
function byteString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

/**
 * Drops the rotation from the appearance PDF exported for a rotated stamp.
 *
 * EmbedPDF's exportAnnotationAppearanceAsPdf keeps the /Matrix of its rotation wrapper form and only cancels the
 * matrix's translation (e, f) with a cm on the exported page, so the rotation part swings the content outside the
 * MediaBox and a stamp created from it is blank. Replacing a b c d with 1 0 0 1 (keeping e f) leaves the unrotated
 * appearance filling the page; the rotation is applied again from the annotation's rotation / unrotatedRect.
 * The replacement is padded to the same length so the xref offsets stay valid. Returns the input when there is no wrapper
 */
export function unrotateExportedAppearance(pdf: Uint8Array): Uint8Array {
  const text = byteString(pdf);
  let out: Uint8Array | null = null;
  for (let mark = text.indexOf(WRAPPER_MARK); mark >= 0; mark = text.indexOf(WRAPPER_MARK, mark + 1)) {
    // The wrapper's dictionary: from its "obj" to the start of its stream
    const start = text.lastIndexOf(' obj', mark);
    const end = text.indexOf('stream', mark);
    if (start < 0 || end < 0) continue;
    const m = /\/Matrix\s*\[([^\]]*)\]/.exec(text.slice(start, end));
    const nums = m?.[1].trim().split(/\s+/);
    if (!m || nums?.length !== 6) continue;
    const replacement = `/Matrix[1 0 0 1 ${nums[4]} ${nums[5]}]`.padEnd(m[0].length, ' ');
    if (replacement.length !== m[0].length) continue;
    out ??= pdf.slice();
    const at = start + m.index;
    for (let i = 0; i < replacement.length; i++) out[at + i] = replacement.charCodeAt(i);
  }
  return out ?? pdf;
}
