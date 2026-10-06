import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSideways, layoutColumn, readVerticalFont } from '../../src/pdf/fonts/vertical';

// BIZ UDPGothic: unitsPerEm 2048, typo ascender 1802 / descender -246, proportional (vmtx differs per glyph)
const font = readVerticalFont(new Uint8Array(readFileSync('public/fonts/BIZUDPGothic-Regular.ttf')));
const cp = (s: string) => s.codePointAt(0)!;

describe('readVerticalFont', () => {
  test('em ボックスの上下を OS/2 の typo 値から読む', () => {
    expect(font.ascent).toBeCloseTo(1802 / 2048, 4);
    expect(font.descent).toBeCloseTo(246 / 2048, 4);
  });

  test('cmap でグリフを引く（BMP は format 4、補助面は format 12）', () => {
    expect(font.glyph(cp('あ'))).toBe(1409);
    expect(font.glyph(cp('漢'))).toBe(2497);
    expect(font.glyph(cp('𠮟'))).toBe(5054);
    expect(font.glyph(0xe000)).toBe(0); // private use: not in the font
  });

  test('GSUB vert で縦書き用の字形に置き換わる。対応の無い字はそのまま', () => {
    expect(font.vertical(font.glyph(cp('ー')))).toBe(12039);
    expect(font.vertical(font.glyph(cp('、')))).toBe(12481);
    expect(font.vertical(font.glyph(cp('漢')))).toBe(2497);
  });

  test('横・縦の送り幅を em 単位で返す（vmtx はグリフごと）', () => {
    expect(font.advance(1409)).toBeCloseTo(2007 / 2048, 4);
    expect(font.verticalAdvance(2497)).toBe(1);
    expect(font.verticalAdvance(12481)).toBeCloseTo(1291 / 2048, 4);
  });

  test('vmtx が無いフォントでは縦の送りは 1em', () => {
    const bytes = new Uint8Array(readFileSync('public/fonts/BIZUDPGothic-Regular.ttf'));
    const dv = new DataView(bytes.buffer);
    // Rename the vmtx table tag so it is not found
    for (let i = 0; i < dv.getUint16(4); i++) {
      const r = 12 + i * 16;
      if (String.fromCharCode(...bytes.subarray(r, r + 4)) === 'vmtx') bytes.set([0x78, 0x78, 0x78, 0x78], r);
    }
    expect(readVerticalFont(bytes).verticalAdvance(12481)).toBe(1);
  });
});

describe('isSideways', () => {
  test('欧文・数字・半角記号は横倒し', () => {
    for (const ch of ['A', 'z', '1', '-', '(', ' ', 'é', 'Ω', '→']) expect(isSideways(cp(ch))).toBe(true);
  });
  test('漢字・かな・全角記号・例外の記号は正立', () => {
    for (const ch of ['漢', 'あ', 'ア', '〇', '　', '（', '１', '±', '×', '①', '■', '※', '𠮟', '😀']) {
      expect(isSideways(cp(ch))).toBe(false);
    }
  });
});

describe('layoutColumn', () => {
  const FS = 10;
  const em = (n: number) => (n / 2048) * FS;

  test('正立の字は列の中心に置き、vmtx の送りで下へ進む', () => {
    const col = layoutColumn('漢、あ', font, FS);
    expect(col.items.map((i) => i.kind)).toEqual(['upright', 'upright', 'upright']);
    const [kan, comma, a] = col.items as Extract<(typeof col.items)[number], { kind: 'upright' }>[];
    // Vertical forms (BIZ UDP also has them for proportional kana); the text is kept for ToUnicode
    expect(comma).toMatchObject({ gid: 12481, text: '、' });
    expect(a).toMatchObject({ gid: 12041, text: 'あ' });
    // Horizontal center: origin at -advance/2 (漢 2048; the vertical あ is 2048 wide, the horizontal one 2007)
    expect(kan.x).toBeCloseTo(-em(2048) / 2, 4);
    expect(a.x).toBeCloseTo(-em(2048) / 2, 4);
    // Baselines: ascent below the top of each cell; cells advance by vmtx (、 1291, あ 2008)
    expect(kan.y).toBeCloseTo(em(1802), 4);
    expect(comma.y).toBeCloseTo(em(2048) + em(1802), 4);
    expect(a.y).toBeCloseTo(em(2048) + em(1291) + em(1802), 4);
    expect(col.length).toBeCloseTo(em(2048) + em(1291) + em(2008), 4);
  });

  test('欧文は 1 つの横倒しの塊になり、横の送りの合計だけ進む', () => {
    const col = layoutColumn('第Aa1章', font, FS);
    expect(col.items.map((i) => [i.kind, i.text])).toEqual([
      ['upright', '第'],
      ['sideways', 'Aa1'],
      ['upright', '章'],
    ]);
    const run = col.items[1] as Extract<(typeof col.items)[number], { kind: 'sideways' }>;
    expect(run.gids).toEqual([1291, 1329, 1275]);
    expect(run.y).toBeCloseTo(em(2048), 4);
    expect(run.length).toBeCloseTo(em(1556 + 1331 + 1290), 4);
    // The em box (-descent .. ascent) is centered on the column
    expect(run.x).toBeCloseTo(-(em(1802) - em(246)) / 2, 4);
    expect(col.items[2].y).toBeCloseTo(em(2048) + run.length + em(1802), 4);
  });

  test('縦書き用の字形がある記号は、横倒しの範囲の字でも正立（三点リーダー）', () => {
    expect(isSideways(cp('…'))).toBe(true);
    const col = layoutColumn('…', font, FS);
    expect(col.items).toHaveLength(1);
    expect(col.items[0]).toMatchObject({ kind: 'upright', gid: 11960 });
  });

  test('空文字列は長さ 0', () => {
    expect(layoutColumn('', font, FS)).toEqual({ items: [], length: 0 });
  });
});
