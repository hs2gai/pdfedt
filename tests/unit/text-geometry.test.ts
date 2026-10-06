import { describe, expect, test } from 'vitest';
import type { PdfRun } from '@embedpdf/models';
import { alignVerticalColumns, type VerticalRun } from '../../src/pdf/text-geometry';

// Glyph boxes as EmbedPDF gives them: top-left origin, whole pt
type Box = [x: number, y: number, width: number, height: number];
const run = (charStart: number, boxes: Box[], flags: number[] = []): PdfRun =>
  ({
    charStart,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    fontSize: 1,
    glyphs: boxes.map(([x, y, width, height], i) => ({ x, y, width, height, flags: flags[i] ?? 0 })),
  }) as unknown as PdfRun;
const extents = (r: PdfRun) => r.glyphs.map((g) => [g.x, g.width]);

describe('alignVerticalColumns', () => {
  test('縦書きの列は、フォントの違う連なり（横倒しの数字）や 1 字だけの連なりもまとめて同じ幅にし、右へ少し広げる', () => {
    const kanji = run(0, [
      [238, 45, 9, 9],
      [238, 54, 9, 9],
      [238, 63, 6, 5], // "・": a narrow box
    ]);
    const digits = run(3, [
      [240, 72, 5, 5],
      [240, 77, 5, 5],
    ]);
    const bracket = run(5, [[241, 82, 6, 9]]);
    const rest = run(6, [
      [238, 91, 9, 9],
      [238, 100, 9, 9],
    ]);
    alignVerticalColumns([kanji, digits, bracket, rest]);
    // 238–247 is 9pt wide; a quarter of it (rounded up to 3pt) is added on the right
    for (const r of [kanji, digits, bracket, rest]) {
      expect(extents(r).every(([x, w]) => x === 238 && w === 12)).toBe(true);
      expect([r.rect.x, r.rect.width]).toEqual([238, 12]);
    }
  });

  test('隣の列（行頭から始まる列）は別の列として、それぞれの幅になる', () => {
    const first = run(0, [
      [238, 45, 9, 9],
      [238, 54, 9, 9],
    ]);
    const second = run(2, [
      [214, 45, 10, 10],
      [214, 55, 10, 10],
    ]);
    alignVerticalColumns([first, second]);
    expect(extents(first)).toEqual([
      [238, 12],
      [238, 12],
    ]);
    expect(extents(second)).toEqual([
      [214, 13],
      [214, 13],
    ]);
  });

  test('横書きの行と、PDFium が補った空白（flags 2）はそのまま', () => {
    const line = run(0, [
      [60, 400, 12, 12],
      [72, 400, 12, 12],
      [84, 400, 6, 12],
    ]);
    const column = run(3, [
      [238, 45, 9, 9],
      [0, 0, 0, 0],
      [238, 54, 9, 9],
      [238, 63, 9, 9],
    ], [0, 2, 0, 0]);
    alignVerticalColumns([line, column]);
    // Only the column is marked for the selection (patched plugin-selection)
    expect((column as VerticalRun).vertical).toBe(true);
    expect((line as VerticalRun).vertical).toBeUndefined();
    expect(extents(line)).toEqual([
      [60, 12],
      [72, 12],
      [84, 6],
    ]);
    expect(extents(column)).toEqual([
      [238, 12],
      [0, 0],
      [238, 12],
      [238, 12],
    ]);
  });

  test('縦中横（横に並べた "40"）は、列の途中でも列の頭でも列に含める', () => {
    const head = run(0, [
      [239, 45, 4, 9],
      [243, 45, 4, 9],
    ]);
    const kanji = run(2, [
      [238, 54, 9, 9],
      [238, 63, 9, 9],
    ]);
    const middle = run(4, [
      [239, 72, 4, 9],
      [243, 72, 4, 9],
    ]);
    const rest = run(6, [
      [238, 81, 9, 9],
      [238, 90, 9, 9],
    ]);
    alignVerticalColumns([head, kanji, middle, rest]);
    for (const r of [head, kanji, middle, rest]) expect(extents(r).every(([x, w]) => x === 238 && w === 12)).toBe(true);
  });

  test('列の中の小さなすき間（丸めで連なりの境目に空く 1pt など）は上の字の箱を伸ばして埋める', () => {
    const upper = run(0, [
      [238, 45, 9, 9],
      [238, 54, 9, 9],
    ]);
    const lower = run(2, [
      [238, 64, 9, 9], // 1pt below the upper run
      [238, 73, 9, 9],
    ]);
    const next = run(4, [
      [214, 45, 9, 9], // the next column, from the top
      [214, 54, 9, 9],
    ]);
    alignVerticalColumns([upper, lower, next]);
    expect(upper.glyphs.map((g) => [g.y, g.height])).toEqual([
      [45, 9],
      [54, 10],
    ]);
    expect([upper.rect.y, upper.rect.height]).toEqual([45, 19]);
    expect(lower.glyphs.map((g) => [g.y, g.height])).toEqual([
      [64, 9],
      [73, 9],
    ]);
    expect(next.glyphs.map((g) => g.height)).toEqual([9, 9]);
  });

  test('1 字だけの連なりは、続く列が無ければ触らない', () => {
    const single = run(0, [[100, 100, 9, 9]]);
    alignVerticalColumns([single]);
    expect(extents(single)).toEqual([[100, 9]]);
  });
});
