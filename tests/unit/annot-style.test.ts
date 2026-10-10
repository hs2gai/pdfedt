import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  findColor,
  hexToRgb,
  rgbToHex,
  styleSpec,
  stylePatch,
} from '../../src/annotations/annot-style';

describe('stylePatch', () => {
  it('図形は枠線の色と太さだけを変え、塗り（color）には触らない', () => {
    expect(stylePatch('square', { color: '#1A73E8', strokeWidth: 3 })).toEqual({
      strokeColor: '#1A73E8',
      strokeWidth: 3,
    });
    expect(stylePatch('lineArrow', { strokeWidth: 0.5 })).toEqual({ strokeWidth: 0.5 });
  });

  it('ペンは color も同じ色にそろえる（strokeColor の旧名）', () => {
    expect(stylePatch('ink', { color: '#000000', strokeWidth: 2 })).toEqual({
      strokeColor: '#000000',
      color: '#000000',
      strokeWidth: 2,
    });
  });

  it('文字に付ける注釈は太さを受け付けない', () => {
    expect(stylePatch('highlight', { color: '#A8E6A1', strokeWidth: 6 })).toEqual({
      strokeColor: '#A8E6A1',
      color: '#A8E6A1',
    });
    expect(stylePatch('underline', { strokeWidth: 6 })).toEqual({});
  });

  it('対象外のツール（スタンプ・付箋・独自テキスト）は何も変えない', () => {
    for (const id of ['stampJa', 'textComment', 'textJa', 'unknown']) {
      expect(stylePatch(id, { color: '#000000', strokeWidth: 1 })).toEqual({});
    }
  });
});

describe('styleSpec', () => {
  it('蛍光ペンだけ淡い色のパレットを使う', () => {
    expect(styleSpec('highlight')?.palette).toBe(HIGHLIGHT_COLORS);
    expect(styleSpec('strikeout')?.palette).toBe(INK_COLORS);
    expect(styleSpec(undefined)).toBeUndefined();
  });

  it('パレットは線用 10 色・蛍光ペン用 5 色で、id と色が重複しない', () => {
    for (const [palette, size] of [
      [INK_COLORS, 10],
      [HIGHLIGHT_COLORS, 5],
    ] as const) {
      expect(palette).toHaveLength(size);
      expect(new Set(palette.map((c) => c.id)).size).toBe(size);
      expect(new Set(palette.map((c) => c.hex)).size).toBe(size);
    }
  });

  it('既定の赤と黄色（embedpdf の既定値）がパレットに含まれる', () => {
    expect(findColor(INK_COLORS, '#e44234')?.id).toBe('red');
    expect(findColor(HIGHLIGHT_COLORS, '#FFCD45')?.id).toBe('yellow');
  });
});

describe('hex ⇔ RGB', () => {
  it('相互に変換でき、16 進は 2 桁ずつ大文字にそろう', () => {
    expect(hexToRgb('#1a73e8')).toEqual({ r: 26, g: 115, b: 232 });
    expect(rgbToHex({ r: 0, g: 5, b: 255 })).toBe('#0005FF');
    for (const c of INK_COLORS) expect(rgbToHex(hexToRgb(c.hex))).toBe(c.hex);
  });

  it('パレットにない色は見つからない', () => {
    expect(findColor(INK_COLORS, '#C80000')).toBeUndefined();
    expect(findColor(INK_COLORS, undefined)).toBeUndefined();
  });
});
