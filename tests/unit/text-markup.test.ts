import { describe, expect, it } from 'vitest';
import { selectionMenuOffset } from '../../src/annotations/text-markup';

const r = (x: number, y: number, width: number, height: number, vertical?: boolean) => ({
  origin: { x, y },
  size: { width, height },
  ...(vertical && { vertical }),
});

describe('selectionMenuOffset', () => {
  it('横書きは最後の行（いちばん下の行）の下に出す', () => {
    const lines = [r(50, 100, 300, 12), r(50, 114, 120, 12)];
    expect(selectionMenuOffset(lines, r(50, 100, 300, 26))).toEqual({ x: 0, y: 26 });
  });

  it('縦書きは最後の列（いちばん左の列）の終わりの下に出す。最初の列が長くてもそちらには引きずられない', () => {
    // The right column runs y=40..440, the column to its left (the last one) ends at y=260
    const columns = [r(300, 40, 14, 400, true), r(280, 40, 14, 220, true)];
    expect(selectionMenuOffset(columns, r(280, 40, 34, 400))).toEqual({ x: 0, y: 220 });
  });

  it('縦書きは矩形の並び順によらず位置で決める', () => {
    const columns = [r(280, 40, 14, 220, true), r(300, 40, 14, 400, true), r(320, 300, 14, 40, true)];
    expect(selectionMenuOffset(columns, r(280, 40, 54, 400))).toEqual({ x: 0, y: 220 });
  });

  it('同じ列に矩形が複数あるときは下の方', () => {
    const columns = [r(300, 40, 14, 100, true), r(280, 40, 14, 60, true), r(281, 120, 13, 80, true)];
    expect(selectionMenuOffset(columns, r(280, 40, 34, 160))).toEqual({ x: 1, y: 160 });
  });

  it('矩形が取れないときは範囲の左下', () => {
    expect(selectionMenuOffset([], r(0, 0, 50, 30))).toEqual({ x: 0, y: 30 });
  });
});
