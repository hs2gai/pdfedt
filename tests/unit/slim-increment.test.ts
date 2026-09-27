import { describe, expect, test } from 'vitest';
import { parseIncrement, writeSlimIncrement } from '../../src/pdf/slim-increment';

const enc = new TextEncoder();
const dec = new TextDecoder('latin1');
const bytes = (s: string) => enc.encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Minimal original file (CRLF-separated, like PDFium's serialization) */
const ORIGINAL = bytes(
  '%PDF-1.4\r\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\r\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\r\n' +
    'xref\r\n0 3\r\n0000000000 65535 f\r\n0000000009 00000 n\r\n0000000052 00000 n\r\ntrailer\r\n<</Size 3/Root 1 0 R>>\r\nstartxref\r\n95\r\n%%EOF\r\n',
);

/** Builds an increment with a classic xref table (objects: objnum -> "N 0 obj ... endobj") */
function classicIncrement(original: Uint8Array, objects: [number, string][]): Uint8Array {
  const parts: Uint8Array[] = [original];
  let offset = original.length;
  const entries: { objnum: number; offset: number }[] = [];
  for (const [objnum, body] of objects) {
    entries.push({ objnum, offset });
    const b = bytes(body + '\r\n');
    parts.push(b);
    offset += b.length;
  }
  const pad = (n: number) => String(n).padStart(10, '0');
  let xref = 'xref\r\n0 1\r\n0000000000 65535 f\r\n';
  for (const e of entries.sort((a, b) => a.objnum - b.objnum)) xref += `${e.objnum} 1\r\n${pad(e.offset)} 00000 n\r\n`;
  xref += `trailer\r\n<</Size 4/Root 1 0 R/Prev 95>>\r\nstartxref\r\n${offset}\r\n%%EOF\r\n`;
  parts.push(bytes(xref));
  return concat(...parts);
}

const PAGES_UNCHANGED = '2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj';
const ANNOT = '3 0 obj<</Type/Annot/Subtype/Square>>endobj';

describe('parseIncrement', () => {
  test('増分内のオブジェクト・空きエントリ・トレーラーを読み取る', () => {
    const full = classicIncrement(ORIGINAL, [
      [2, PAGES_UNCHANGED],
      [3, ANNOT],
    ]);
    const parsed = parseIncrement(full, ORIGINAL.length);
    expect(parsed.mode).toBe('table');
    expect([...parsed.objects.keys()].sort()).toEqual([2, 3]);
    expect(dec.decode(parsed.objects.get(3)!)).toBe(ANNOT);
    expect(parsed.free.map((e) => e.objnum)).toEqual([0]);
    expect(parsed.trailerBody).toContain('/Size 4');
    expect(parsed.trailerBody).toContain('/Root 1 0 R');
    expect(parsed.trailerBody).toContain('/Prev 95');
  });
  test('startxref が無い、または元ファイル側を指していれば例外', () => {
    expect(() => parseIncrement(concat(ORIGINAL, bytes('garbage')), ORIGINAL.length)).toThrow(/startxref/);
    const bad = concat(ORIGINAL, bytes('xref\r\n0 0\r\ntrailer\r\n<<>>\r\nstartxref\r\n9\r\n%%EOF\r\n'));
    expect(() => parseIncrement(bad, ORIGINAL.length)).toThrow(/not inside/);
  });
});

describe('writeSlimIncrement', () => {
  const full = classicIncrement(ORIGINAL, [
    [2, PAGES_UNCHANGED],
    [3, ANNOT],
  ]);
  const parsed = parseIncrement(full, ORIGINAL.length);

  test('基準と同じオブジェクトは落とし、元ファイルはバイト単位で温存する', () => {
    const baseline = new Map([[2, bytes(PAGES_UNCHANGED)]]);
    const out = writeSlimIncrement(ORIGINAL, parsed, baseline);
    expect(out.subarray(0, ORIGINAL.length)).toEqual(ORIGINAL);
    const text = dec.decode(out.subarray(ORIGINAL.length));
    expect(text).toContain(ANNOT);
    expect(text).not.toContain('/Type/Pages'); // Unchanged object 2 is left out of the increment
    expect(text).toContain('/Prev 95');
    expect(text.endsWith('%%EOF\r\n')).toBe(true);
  });
  test('書き直した増分は再び解析でき、オフセットが正しい', () => {
    const out = writeSlimIncrement(ORIGINAL, parsed, new Map([[2, bytes(PAGES_UNCHANGED)]]));
    const again = parseIncrement(out, ORIGINAL.length);
    expect([...again.objects.keys()]).toEqual([3]);
    expect(dec.decode(again.objects.get(3)!)).toBe(ANNOT);
    expect(again.free.map((e) => e.objnum)).toEqual([0]);
  });
  test('基準が無ければ何も落とさない（PDFium の増分と同じ内容）', () => {
    const out = writeSlimIncrement(ORIGINAL, parsed, new Map());
    const again = parseIncrement(out, ORIGINAL.length);
    expect([...again.objects.keys()].sort()).toEqual([2, 3]);
  });
  test('内容が変わったオブジェクトは基準にあっても残す', () => {
    const changed = classicIncrement(ORIGINAL, [[2, '2 0 obj<</Type/Pages/Count 1/Kids[4 0 R]>>endobj']]);
    const out = writeSlimIncrement(ORIGINAL, parseIncrement(changed, ORIGINAL.length), new Map([[2, bytes(PAGES_UNCHANGED)]]));
    expect(dec.decode(out)).toContain('/Kids[4 0 R]');
  });
});
