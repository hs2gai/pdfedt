import { layoutColumn, readVerticalFont } from './fonts/vertical';
import { readSfntFaces, sfntTables } from './fonts/sfnt';

/**
 * Writes a one-page PDF holding a single column of genuine vertical text (Type0 font, Identity-V = WMode 1).
 * PDFium's editing API can only create horizontal (Identity-H) fonts, so content editing builds the column
 * here and imports the page into the document as a Form XObject (FPDF_NewXObjectFromPage).
 *
 * The page's MediaBox starts at 0 0 (FPDF_NewXObjectFromPage moves its lower-left corner to the form's origin),
 * and `anchor` is where the top center of the column is: translate by -anchor, then apply the original text
 * object's matrix to put the new text where the old one started. Upright characters use the font's vertical forms and
 * advance by vmtx (W2); Latin runs are set with the same font as Identity-H, rotated 90° clockwise.
 * Only TrueType outlines (glyf) are supported: the font is embedded as FontFile2 with CIDToGIDMap Identity.
 */
export interface VerticalTextSpec {
  text: string;
  /** TrueType font (normally a subset holding the text, with GSUB and vmtx kept) */
  fontBytes: Uint8Array;
  fontSize: number;
  /** 0–255 */
  color: { r: number; g: number; b: number };
  /** Synthetic bold: fill + a thin stroke (same as horizontal replacement) */
  bold?: boolean;
}

/** Whether the font has TrueType outlines (the only kind buildVerticalTextPdf embeds) */
export function hasTrueTypeOutlines(fontBytes: Uint8Array): boolean {
  return sfntTables(new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength)).has('glyf');
}

export interface VerticalTextPdf {
  pdf: Uint8Array;
  /** Top center of the column in the page's coordinates */
  anchor: { x: number; y: number };
}

export function buildVerticalTextPdf(spec: VerticalTextSpec): VerticalTextPdf {
  const { fontBytes, fontSize: fs, color } = spec;
  const font = readVerticalFont(fontBytes);
  // A replacement is one column (like horizontal replacement, which is one line)
  const column = layoutColumn(spec.text.replace(/\r?\n/g, ''), font, fs);
  const num = (v: number) => String(Math.round(v * 1000) / 1000);
  const em = (v: number) => Math.round(v * 1000);
  const hex = (gids: number[]) => gids.map((g) => g.toString(16).toUpperCase().padStart(4, '0')).join('');
  const rgb = [color.r, color.g, color.b].map((v) => num(v / 255)).join(' ');

  const unicode = new Map<number, string>();
  const upright = new Set<number>();
  const pad = fs / 2;
  const half = fs / 2 + pad;
  const anchor = { x: half, y: column.length + pad };
  const ops = [`1 0 0 1 ${num(anchor.x)} ${num(anchor.y)} cm`, `${rgb} rg`];
  if (spec.bold) ops.push(`2 Tr ${num(fs * 0.03)} w ${rgb} RG`);
  let segment: number[] = [];
  let segmentTop = 0;
  const flush = () => {
    if (segment.length) ops.push(`BT /FV ${num(fs)} Tf 1 0 0 1 0 ${num(-segmentTop)} Tm <${hex(segment)}> Tj ET`);
    segment = [];
  };
  for (const item of column.items) {
    if (item.kind === 'upright') {
      // Consecutive upright glyphs share one show: the vertical metrics (W2) move the pen down
      if (!segment.length) segmentTop = item.y - font.ascent * fs;
      segment.push(item.gid);
      upright.add(item.gid);
      unicode.set(item.gid, item.text);
      continue;
    }
    flush();
    [...item.text].forEach((ch, i) => unicode.set(item.gids[i], ch));
    ops.push(`BT /FH ${num(fs)} Tf 0 -1 1 0 ${num(item.x)} ${num(-item.y)} Tm <${hex(item.gids)}> Tj ET`);
  }
  flush();

  const gids = [...unicode.keys()].sort((a, b) => a - b);
  const widths = gids.map((g) => `${g} [${em(font.advance(g))}]`).join(' ');
  const vertical = [...upright]
    .sort((a, b) => a - b)
    .map((g) => `${g} ${g} ${-em(font.verticalAdvance(g))} ${em(font.advance(g) / 2)} ${em(font.ascent)}`)
    .join(' ');
  const mediaBox = [0, 0, half * 2, column.length + pad * 2].map(num).join(' ');
  const name = `PDFEDT+${(readSfntFaces(fontBytes)[0]?.postscriptName || 'Font').replace(/[^\x21-\x7e]|[()<>[\]{}/%#]/g, '')}`;
  const dv = new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength);
  const head = sfntTables(dv).get('head')!;
  const bbox = [36, 38, 40, 42].map((o) => Math.round((dv.getInt16(head + o) * 1000) / font.unitsPerEm)).join(' ');

  const latin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const objects: (string | { dict: string; data: Uint8Array })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /FV 9 0 R /FH 10 0 R >> >> /Contents 4 0 R >>`,
    { dict: '', data: latin(ops.join('\n')) },
    { dict: `/Length1 ${fontBytes.byteLength}`, data: fontBytes },
    `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${em(font.ascent)} /Descent ${-em(font.descent)} /CapHeight ${em(font.ascent)} /StemV 80 /FontFile2 5 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /CIDToGIDMap /Identity /W [${widths}] /DW2 [${em(font.ascent)} -1000] /W2 [${vertical}] >>`,
    { dict: '', data: latin(toUnicodeCMap(unicode)) },
    ...['Identity-V', 'Identity-H'].map(
      (encoding) =>
        `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /${encoding} /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>`,
    ),
  ];
  return { pdf: serialize(objects), anchor };
}

/** ToUnicode CMap: glyph ID → the character it shows (vertical forms map back to the original character) */
function toUnicodeCMap(unicode: Map<number, string>): string {
  const utf16 = (s: string) =>
    Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('');
  const entries = [...unicode].sort(([a], [b]) => a - b).map(([g, s]) => `<${g.toString(16).toUpperCase().padStart(4, '0')}> <${utf16(s)}>`);
  const blocks: string[] = [];
  // At most 100 entries per bfchar block
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    ...blocks,
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
}

/** Objects are numbered from 1 in order; streams get their /Length */
function serialize(objects: (string | { dict: string; data: Uint8Array })[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? Uint8Array.from(p, (c) => c.charCodeAt(0)) : p;
    parts.push(bytes);
    length += bytes.byteLength;
  };
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
  const offsets = objects.map((obj, i) => {
    const offset = length;
    push(`${i + 1} 0 obj\n`);
    if (typeof obj === 'string') push(`${obj}\n`);
    else {
      push(`<< ${obj.dict} /Length ${obj.data.byteLength} >>\nstream\n`);
      push(obj.data);
      push('\nendstream\n');
    }
    push('endobj\n');
    return offset;
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((o) => push(`${String(o).padStart(10, '0')} 00000 n \n`));
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
