import { describe, expect, test } from 'vitest';
import {
  findLocalFont,
  isBoldFace,
  isLocalFontId,
  japaneseLocalFonts,
  localFontById,
  localFontId,
  type LocalFontData,
} from '../../src/pdf/fonts/local-fonts';

const font = (postscriptName: string, fullName: string, family = fullName, style = 'Regular'): LocalFontData => ({
  postscriptName,
  fullName,
  family,
  style,
  blob: () => Promise.reject(new Error('not used')),
});

const catalog = [
  font('Arial', 'Arial'),
  font('Arial-BoldMT', 'Arial Bold', 'Arial', 'Bold'),
  font('MS-Mincho', 'MS Mincho'),
  font('MS-PMincho', 'MS PMincho'),
  font('MS-Gothic', 'MS Gothic'),
  font('YuGothic-Regular', 'Yu Gothic', 'Yu Gothic'),
  font('YuGothic-Bold', 'Yu Gothic Bold', 'Yu Gothic', 'Bold'),
  font('IPAGothic', 'IPAGothic'),
  font('Meiryo', 'Meiryo'),
  font('SegoeUI', 'Segoe UI'),
  font('YuMincho-Regular', '游明朝', '游明朝'),
];

describe('findLocalFont（PDF の BaseFont → PC のフォント）', () => {
  test('PostScript 名で一致', () => {
    expect(findLocalFont('MS-Mincho', catalog)?.postscriptName).toBe('MS-Mincho');
  });
  test('サブセット接頭辞（ABCDEF+）を外して照合', () => {
    expect(findLocalFont('ABCDEF+MS-Mincho', catalog)?.postscriptName).toBe('MS-Mincho');
  });
  test('ハイフン・空白・大文字小文字の違いは無視（フルネームでも一致）', () => {
    expect(findLocalFont('MSMincho', catalog)?.postscriptName).toBe('MS-Mincho');
    expect(findLocalFont('ms mincho', catalog)?.postscriptName).toBe('MS-Mincho');
  });
  test('MS-Mincho と MS-PMincho を取り違えない', () => {
    expect(findLocalFont('MS-PMincho', catalog)?.postscriptName).toBe('MS-PMincho');
  });
  test('",Bold" のスタイル接尾辞: 太字の書体があればそれ、無ければ本体', () => {
    expect(findLocalFont('YuGothic,Bold', catalog)?.postscriptName).toBe('YuGothic-Bold');
    expect(findLocalFont('MS-Gothic,Bold', catalog)?.postscriptName).toBe('MS-Gothic');
  });
  test('無ければ undefined', () => {
    expect(findLocalFont('HeiseiMin-W3', catalog)).toBeUndefined();
  });
});

describe('isBoldFace', () => {
  test('太字の書体そのものなら疑似ボールド不要', () => {
    expect(isBoldFace(font('YuGothic-Bold', 'Yu Gothic Bold', 'Yu Gothic', 'Bold'))).toBe(true);
    expect(isBoldFace(font('MS-Gothic', 'MS Gothic'))).toBe(false);
  });
});

describe('japaneseLocalFonts（書体の選択肢に出す候補）', () => {
  test('和文向けらしい名前だけ残し、名前順に並べる', () => {
    const names = japaneseLocalFonts(catalog).map((f) => f.postscriptName);
    expect(names).not.toContain('Arial');
    expect(names).not.toContain('SegoeUI');
    expect(names).toEqual(expect.arrayContaining(['MS-Mincho', 'MS-Gothic', 'YuGothic-Regular', 'IPAGothic', 'Meiryo', 'YuMincho-Regular']));
    const fullNames = japaneseLocalFonts(catalog).map((f) => f.fullName);
    expect(fullNames).toEqual([...fullNames].sort((a, b) => a.localeCompare(b, 'ja')));
  });
  test('同じ PostScript 名は 1 つにまとめる', () => {
    const dup = [font('IPAGothic', 'IPAGothic'), font('IPAGothic', 'IPAGothic')];
    expect(japaneseLocalFonts(dup)).toHaveLength(1);
  });
});

describe('書体 ID（local:<PostScript 名>）', () => {
  test('ID の生成・判定・逆引き', () => {
    const f = catalog[2];
    const id = localFontId(f);
    expect(id).toBe('local:MS-Mincho');
    expect(isLocalFontId(id)).toBe(true);
    expect(isLocalFontId('gothic')).toBe(false);
    expect(localFontById(id, catalog)).toBe(f);
    expect(localFontById('local:NotInstalled', catalog)).toBeUndefined();
  });
});
