import { sfntTables } from './sfnt';

/**
 * Vertical writing (tategaki) layout for TrueType / OpenType fonts.
 * Reads what a column needs straight from the font tables: cmap (code point → glyph), hmtx / vmtx (advances),
 * OS/2 (em box) and the GSUB 'vert' feature (vertical forms such as "ー" "、" "「").
 * Works on a single face (subset fonts produced by harfbuzz keep GSUB and vmtx).
 */
export interface VerticalFont {
  unitsPerEm: number;
  /** Em box above / below the baseline (em, both positive; ascent + descent is about 1) */
  ascent: number;
  descent: number;
  /** Glyph for a code point (0 = .notdef) */
  glyph(cp: number): number;
  /** Vertical form of a glyph (GSUB 'vert'), or the glyph itself */
  vertical(gid: number): number;
  /** Horizontal advance (em) */
  advance(gid: number): number;
  /** Vertical advance (em; 1 when the font has no vmtx) */
  verticalAdvance(gid: number): number;
}

export function readVerticalFont(bytes: Uint8Array): VerticalFont {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = sfntTables(dv);
  const table = (tag: string) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`Font has no ${tag} table`);
    return offset;
  };
  const head = table('head');
  const unitsPerEm = dv.getUint16(head + 18);
  const hhea = table('hhea');
  const os2 = tables.get('OS/2');
  const ascent = (os2 !== undefined ? dv.getInt16(os2 + 68) : dv.getInt16(hhea + 4)) / unitsPerEm;
  const descent = -(os2 !== undefined ? dv.getInt16(os2 + 70) : dv.getInt16(hhea + 6)) / unitsPerEm;

  const metrics = (mtx: number, count: number) => (gid: number) =>
    dv.getUint16(mtx + Math.min(gid, count - 1) * 4) / unitsPerEm;
  const advance = metrics(table('hmtx'), dv.getUint16(hhea + 34));
  const vhea = tables.get('vhea');
  const vmtx = tables.get('vmtx');
  const verticalAdvance =
    vhea !== undefined && vmtx !== undefined ? metrics(vmtx, dv.getUint16(vhea + 34)) : () => 1;

  const vert = readVertSubstitutions(dv, tables.get('GSUB'));
  return {
    unitsPerEm,
    ascent,
    descent,
    glyph: readCmap(dv, table('cmap')),
    vertical: (gid) => vert.get(gid) ?? gid,
    advance,
    verticalAdvance,
  };
}

/**
 * Whether a character is laid on its side in a vertical column (rotated 90° clockwise), following
 * Unicode's Vertical_Orientation (UAX #50) in simplified form: Latin, digits, half-width symbols and
 * most arrows / math are sideways; CJK, kana, full-width forms and the symbols listed below are upright.
 * Characters that have a vertical form in the font are always set upright (see layoutColumn).
 */
export function isSideways(cp: number): boolean {
  return !UPRIGHT.some(([from, to]) => cp >= from && cp <= to);
}

const UPRIGHT: [number, number][] = [
  [0xa7, 0xa7], // §
  [0xa9, 0xa9], // ©
  [0xae, 0xae], // ®
  [0xb1, 0xb1], // ±
  [0xbc, 0xbe], // ¼ ½ ¾
  [0xd7, 0xd7], // ×
  [0xf7, 0xf7], // ÷
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2016, 0x2016], // ‖
  [0x2020, 0x2021], // † ‡
  [0x2030, 0x2031], // ‰ ‱
  [0x203b, 0x203c], // ※ ‼
  [0x2042, 0x2042], // ⁂
  [0x2047, 0x2049], // ⁇ ⁈ ⁉
  [0x2051, 0x2051], // ⁑
  [0x2100, 0x218f], // letterlike symbols, number forms
  [0x2400, 0x243f], // control pictures
  [0x2460, 0x24ff], // enclosed alphanumerics (①)
  [0x25a0, 0x27bf], // geometric shapes, misc symbols, dingbats
  [0x2e80, 0xfffd], // CJK, kana, compatibility and full-width forms
  [0x1f000, 0x1faff], // emoji and other pictographs
  [0x20000, 0x3ffff], // CJK extensions
];

export interface UprightGlyph {
  kind: 'upright';
  text: string;
  gid: number;
  /** Glyph origin relative to the column's center line (pt, x to the right) */
  x: number;
  /** Baseline below the top of the column (pt, downward) */
  y: number;
}

export interface SidewaysRun {
  kind: 'sideways';
  text: string;
  /** Horizontal glyphs, drawn rotated 90° clockwise */
  gids: number[];
  /** Baseline relative to the column's center line (pt, x to the right) */
  x: number;
  /** Where the run starts below the top of the column (pt, downward) */
  y: number;
  /** Length along the column (pt) */
  length: number;
}

export type ColumnItem = UprightGlyph | SidewaysRun;

export interface Column {
  items: ColumnItem[];
  /** Length of the column (pt) */
  length: number;
}

/**
 * Lays out one column of vertical text.
 * Upright glyphs are centered on the column (vertical forms when the font has them) and advance by vmtx;
 * consecutive sideways characters become one run rotated 90° clockwise, with its em box centered on the column.
 */
export function layoutColumn(text: string, font: VerticalFont, fontSize: number): Column {
  const items: ColumnItem[] = [];
  let pen = 0;
  let run: SidewaysRun | null = null;
  for (const ch of text) {
    const gid = font.glyph(ch.codePointAt(0)!);
    const alt = font.vertical(gid);
    if (alt === gid && isSideways(ch.codePointAt(0)!)) {
      if (!run) {
        run = { kind: 'sideways', text: '', gids: [], x: -((font.ascent - font.descent) / 2) * fontSize, y: pen, length: 0 };
        items.push(run);
      }
      const w = font.advance(gid) * fontSize;
      run.text += ch;
      run.gids.push(gid);
      run.length += w;
      pen += w;
      continue;
    }
    run = null;
    items.push({ kind: 'upright', text: ch, gid: alt, x: (-font.advance(alt) * fontSize) / 2, y: pen + font.ascent * fontSize });
    pen += font.verticalAdvance(alt) * fontSize;
  }
  return { items, length: pen };
}

// ---------------------------------------------------------------------------
// cmap

/** Prefers a full-Unicode subtable (format 12), then the BMP one (format 4) */
function readCmap(dv: DataView, cmap: number): (cp: number) => number {
  const count = dv.getUint16(cmap + 2);
  const subtables = Array.from({ length: count }, (_, i) => {
    const r = cmap + 4 + i * 8;
    const offset = cmap + dv.getUint32(r + 4);
    return { platform: dv.getUint16(r), encoding: dv.getUint16(r + 2), offset, format: dv.getUint16(offset) };
  });
  const unicode = subtables.filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
  const f12 = unicode.find((s) => s.format === 12);
  if (f12) return cmapFormat12(dv, f12.offset);
  const f4 = unicode.find((s) => s.format === 4);
  if (f4) return cmapFormat4(dv, f4.offset);
  throw new Error('Font has no Unicode cmap');
}

function cmapFormat4(dv: DataView, t: number): (cp: number) => number {
  const segs = dv.getUint16(t + 6) / 2;
  const ends = t + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const rangeOffsets = deltas + segs * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    let lo = 0;
    let hi = segs - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dv.getUint16(ends + mid * 2) < cp) lo = mid + 1;
      else hi = mid;
    }
    const start = dv.getUint16(starts + lo * 2);
    if (cp < start || cp > dv.getUint16(ends + lo * 2)) return 0;
    const delta = dv.getUint16(deltas + lo * 2);
    const ro = dv.getUint16(rangeOffsets + lo * 2);
    if (ro === 0) return (cp + delta) & 0xffff;
    const g = dv.getUint16(rangeOffsets + lo * 2 + ro + (cp - start) * 2);
    return g === 0 ? 0 : (g + delta) & 0xffff;
  };
}

function cmapFormat12(dv: DataView, t: number): (cp: number) => number {
  const groups = dv.getUint32(t + 12);
  const at = (i: number) => t + 16 + i * 12;
  return (cp) => {
    let lo = 0;
    let hi = groups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = at(mid);
      if (cp < dv.getUint32(g)) hi = mid - 1;
      else if (cp > dv.getUint32(g + 4)) lo = mid + 1;
      else return dv.getUint32(g + 8) + (cp - dv.getUint32(g));
    }
    return 0;
  };
}

// ---------------------------------------------------------------------------
// GSUB 'vert' (falls back to 'vrt2'); only single substitutions (type 1, possibly wrapped in type 7)

const GSUB_SINGLE = 1;
const GSUB_EXTENSION = 7;

function readVertSubstitutions(dv: DataView, gsub: number | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (gsub === undefined) return out;
  const features = gsub + dv.getUint16(gsub + 6);
  const lookups = gsub + dv.getUint16(gsub + 8);
  const lookupIndexes = (tag: string) => {
    const indexes = new Set<number>();
    for (let i = 0; i < dv.getUint16(features); i++) {
      const r = features + 2 + i * 6;
      const t = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
      if (t !== tag) continue;
      const feature = features + dv.getUint16(r + 4);
      for (let j = 0; j < dv.getUint16(feature + 2); j++) indexes.add(dv.getUint16(feature + 4 + j * 2));
    }
    return indexes;
  };
  let indexes = lookupIndexes('vert');
  if (indexes.size === 0) indexes = lookupIndexes('vrt2');
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const lookup = lookups + dv.getUint16(lookups + 2 + index * 2);
    const type = dv.getUint16(lookup);
    for (let s = 0; s < dv.getUint16(lookup + 4); s++) {
      let sub = lookup + dv.getUint16(lookup + 6 + s * 2);
      let subType = type;
      if (subType === GSUB_EXTENSION) {
        subType = dv.getUint16(sub + 2);
        sub += dv.getUint32(sub + 4);
      }
      if (subType === GSUB_SINGLE) readSingleSubstitution(dv, sub, out);
    }
  }
  return out;
}

function readSingleSubstitution(dv: DataView, sub: number, out: Map<number, number>) {
  const format = dv.getUint16(sub);
  const covered = readCoverage(dv, sub + dv.getUint16(sub + 2));
  covered.forEach((gid, i) => {
    if (out.has(gid)) return; // The first lookup wins
    if (format === 1) out.set(gid, (gid + dv.getInt16(sub + 4)) & 0xffff);
    else if (format === 2 && i < dv.getUint16(sub + 4)) out.set(gid, dv.getUint16(sub + 6 + i * 2));
  });
}

/** Glyphs in coverage-index order */
function readCoverage(dv: DataView, c: number): number[] {
  const format = dv.getUint16(c);
  const count = dv.getUint16(c + 2);
  if (format === 1) return Array.from({ length: count }, (_, i) => dv.getUint16(c + 4 + i * 2));
  const glyphs: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = c + 4 + i * 6;
    const start = dv.getUint16(r);
    const end = dv.getUint16(r + 2);
    const first = dv.getUint16(r + 4);
    for (let g = start; g <= end; g++) glyphs[first + g - start] = g;
  }
  return glyphs;
}
