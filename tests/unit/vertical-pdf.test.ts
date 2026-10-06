import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildVerticalTextPdf } from '../../src/pdf/vertical-pdf';
import { readVerticalFont } from '../../src/pdf/fonts/vertical';

const fontBytes = new Uint8Array(readFileSync('public/fonts/BIZUDPGothic-Regular.ttf'));
const font = readVerticalFont(fontBytes);
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const hex = (gid: number) => gid.toString(16).toUpperCase().padStart(4, '0');

describe('buildVerticalTextPdf', () => {
  const { pdf, anchor } = buildVerticalTextPdf({ text: '第2章、ー', fontBytes, fontSize: 10, color: { r: 255, g: 0, b: 0 } });
  const s = latin1(pdf);

  test('xref の各オフセットが「n 0 obj」を指す', () => {
    const start = Number(/startxref\s+(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const rows = s.slice(start).split('\n').slice(3).filter((l) => / n\s*$/.test(l));
    expect(rows.length).toBeGreaterThan(5);
    rows.forEach((row, i) => {
      const offset = Number(row.slice(0, 10));
      expect(s.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  test('正立の字は Identity-V のフォントで、縦書き用の字形の GID を書く', () => {
    expect(s).toContain('/Encoding /Identity-V');
    const upright = ['第', '章', '、', 'ー'].map((c) => font.vertical(font.glyph(c.codePointAt(0)!)));
    // 第 starts at the top; 章、ー follow the sideways "2" as one segment
    expect(s).toContain(`BT /FV 10 Tf 1 0 0 1 0 0 Tm <${hex(upright[0])}> Tj ET`);
    expect(s).toContain(`<${upright.slice(1).map(hex).join('')}> Tj ET`);
  });

  test('欧文は Identity-H のフォントを 90° 回して置く', () => {
    expect(s).toContain('/Encoding /Identity-H');
    expect(s).toMatch(new RegExp(`BT /FH 10 Tf 0 -1 1 0 -?[\\d.]+ -10 Tm <${hex(font.glyph(0x32))}> Tj ET`));
  });

  test('縦の送りと原点を W2 / DW2 に書き、ToUnicode で元の文字に戻せる', () => {
    expect(s).toMatch(/\/DW2 \[880 -1000\]/);
    const comma = font.vertical(font.glyph('、'.codePointAt(0)!));
    // 、 (vertical form): advances 1291/2048 em down; 2048 wide, so its origin is 500 from the left
    expect(s).toContain(`${comma} ${comma} -630 500 880`);
    expect(s).toContain(`<${hex(comma)}> <3001>`);
  });

  test('色と、太字の擬似（塗り＋細い線）', () => {
    expect(s).toContain('1 0 0 rg');
    expect(s).not.toContain(' Tr');
    const bold = latin1(buildVerticalTextPdf({ text: '漢', fontBytes, fontSize: 10, color: { r: 0, g: 0, b: 0 }, bold: true }).pdf);
    expect(bold).toContain('2 Tr 0.3 w 0 0 0 RG');
  });

  test('MediaBox は 0 0 から列全体を囲み、anchor（列の上端中央）へ原点を移して描く', () => {
    const m = /\/MediaBox \[([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)\]/.exec(s)!.slice(1).map(Number);
    expect(m.slice(0, 2)).toEqual([0, 0]);
    // Width: 1 em plus half an em of margin on each side; the column (about 42pt) plus margins fits in the height
    expect(m[2]).toBe(20);
    expect(m[3]).toBeGreaterThan(42 + 10);
    expect(anchor.x).toBe(10);
    expect(anchor.y).toBeCloseTo(m[3] - 5, 2);
    expect(s).toContain(`1 0 0 1 10 ${Math.round(anchor.y * 1000) / 1000} cm`);
  });
});
