import type { MessageKey } from '../../i18n';
/**
 * Minimal parser for TrueType / OpenType (and TTC collections).
 * Reads only each face's names and embedding permission (OS/2 fsType).
 * Local fonts are often TTCs with several faces in one file (msmincho.ttc etc.),
 * so we need the index of the face matching the PDF BaseFont.
 */
export interface SfntFace {
  /** Position inside the TTC (0 for a single font) */
  index: number;
  postscriptName: string;
  /** English full name */
  fullName: string;
  fsType: number;
}

const TAG_TTCF = 0x74746366; // 'ttcf'
const NAME_FULL = 4;
const NAME_POSTSCRIPT = 6;
const LANG_EN_US = 0x409;

export function readSfntFaces(bytes: Uint8Array): SfntFace[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return faceOffsets(dv).map((offset, index) => readFace(dv, offset, index));
}

/**
 * Extracts one face from a TTC as a standalone TTF/OTF (tables are copied as-is).
 * PDFium always uses the first face when given a TTC, so display fonts are passed this way. Single fonts are returned unchanged.
 */
export function extractSfntFace(bytes: Uint8Array, index: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = faceOffsets(dv);
  if (offsets.length === 1 && index === 0) return bytes;
  const base = offsets[index];
  const numTables = dv.getUint16(base + 4);
  const dirSize = 12 + numTables * 16;
  let total = dirSize;
  for (let i = 0; i < numTables; i++) total += (dv.getUint32(base + 12 + i * 16 + 12) + 3) & ~3;
  const out = new Uint8Array(total);
  out.set(bytes.subarray(base, base + dirSize)); // sfnt version, numTables and the search fields are kept as-is
  const odv = new DataView(out.buffer);
  let cursor = dirSize;
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + i * 16;
    const offset = dv.getUint32(r + 8);
    const length = dv.getUint32(r + 12);
    out.set(bytes.subarray(offset, offset + length), cursor);
    odv.setUint32(12 + i * 16 + 8, cursor);
    cursor += (length + 3) & ~3;
  }
  return out;
}

function faceOffsets(dv: DataView): number[] {
  return dv.getUint32(0) === TAG_TTCF
    ? Array.from({ length: dv.getUint32(8) }, (_, i) => dv.getUint32(12 + i * 4))
    : [0];
}

/**
 * Looks at OS/2 fsType and returns why embedding in a PDF is not allowed (null when allowed).
 * Only the lowest 4 bits == 2 means Restricted License (other bits are Preview & Print / Editable).
 */
export function embedRestriction(fsType: number): MessageKey | null {
  if ((fsType & 0x000f) === 0x0002) return 'font.embedDenied';
  if (fsType & 0x0200) return 'font.bitmapOnly';
  if (fsType & 0x0100) return 'font.noSubset';
  return null;
}

/** Table tag → absolute offset of the table, for the face whose table directory starts at `faceOffset` */
export function sfntTables(dv: DataView, faceOffset = 0): Map<string, number> {
  const numTables = dv.getUint16(faceOffset + 4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const r = faceOffset + 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
    tables.set(tag, dv.getUint32(r + 8));
  }
  return tables;
}

function readFace(dv: DataView, offset: number, index: number): SfntFace {
  const tables = sfntTables(dv, offset);
  const os2 = tables.get('OS/2');
  const name = tables.get('name');
  const names = name === undefined ? new Map<string, string>() : readNames(dv, name);
  return {
    index,
    postscriptName: names.get(`${NAME_POSTSCRIPT}:en`) ?? names.get(`${NAME_POSTSCRIPT}:mac`) ?? '',
    fullName: names.get(`${NAME_FULL}:en`) ?? names.get(`${NAME_FULL}:mac`) ?? '',
    fsType: os2 === undefined ? 0 : dv.getUint16(os2 + 8),
  };
}

/** Returns the name table as "nameID:en|mac" → string. Only Windows English (UTF-16BE) and Mac Roman (ASCII) are handled */
function readNames(dv: DataView, offset: number): Map<string, string> {
  const count = dv.getUint16(offset + 2);
  const storage = offset + dv.getUint16(offset + 4);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const r = offset + 6 + i * 12;
    const platform = dv.getUint16(r);
    const encoding = dv.getUint16(r + 2);
    const language = dv.getUint16(r + 4);
    const nameId = dv.getUint16(r + 6);
    const length = dv.getUint16(r + 8);
    const start = storage + dv.getUint16(r + 10);
    if (nameId !== NAME_FULL && nameId !== NAME_POSTSCRIPT) continue;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      if (language !== LANG_EN_US) continue;
      let s = '';
      for (let j = 0; j < length; j += 2) s += String.fromCharCode(dv.getUint16(start + j));
      out.set(`${nameId}:en`, s);
    } else if (platform === 1 && encoding === 0) {
      let s = '';
      for (let j = 0; j < length; j++) s += String.fromCharCode(dv.getUint8(start + j));
      out.set(`${nameId}:mac`, s);
    }
  }
  return out;
}
