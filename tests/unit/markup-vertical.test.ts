import { describe, expect, test } from 'vitest';
import {
  charFlowIsVertical,
  flowIsVertical,
  markupAppearanceStream,
  markupQuadPoints,
} from '../../src/pdf/markup-vertical';

// Page space (PDF coordinates, y up). A vertical column 12pt wide: x 494–506, y 539–742
const column = { left: 494, bottom: 539, right: 506, top: 742 };
const line = { left: 60, bottom: 439, right: 143, top: 451 };

describe('flowIsVertical', () => {
  test('文字の中心が縦に並べば縦書き、横に並べば横書き', () => {
    expect(flowIsVertical([{ x: 500, y: 736 }, { x: 500, y: 724 }, { x: 500, y: 712 }])).toBe(true);
    expect(flowIsVertical([{ x: 66, y: 445 }, { x: 78, y: 445 }])).toBe(false);
  });
  test('1 文字以下では決められない', () => {
    expect(flowIsVertical([{ x: 500, y: 736 }])).toBeNull();
    expect(flowIsVertical([])).toBeNull();
  });
});

describe('charFlowIsVertical', () => {
  // 12pt glyph boxes
  test('縦書き（WMode 1）の字は原点が箱の左右中央にある', () => {
    expect(charFlowIsVertical({ left: 494, bottom: 730, right: 506, top: 742 }, { x: 500, y: 742 }, 0)).toBe(true);
  });
  test('横書きの字は原点が箱の左端にある', () => {
    expect(charFlowIsVertical({ left: 60, bottom: 437.6, right: 72, top: 449.6 }, { x: 60, y: 439 }, 0)).toBe(false);
  });
  test('90° 回転した横書き（縦の列に横倒しで入った欧文）は縦に流れる', () => {
    // Baseline at x = 500 - 4.56, ink from -0.12 em to +0.88 em to its right
    const box = { left: 494, bottom: 700, right: 506, top: 707 };
    expect(charFlowIsVertical(box, { x: 495.44, y: 707 }, (3 * Math.PI) / 2)).toBe(true);
    expect(charFlowIsVertical(box, { x: 495.44, y: 707 }, Math.PI / 2)).toBe(true);
  });
});

describe('markupQuadPoints', () => {
  test('横書きは左上・右上・左下・右下（Acrobat と同じ Z 順）', () => {
    expect(markupQuadPoints(line, false)).toEqual([60, 451, 143, 451, 60, 439, 143, 439]);
  });
  test('縦書きは文字の流れ（下向き）を上辺とし、右側を下辺にする（右に傍線）', () => {
    expect(markupQuadPoints(column, true)).toEqual([494, 742, 494, 539, 506, 742, 506, 539]);
  });
});

describe('markupAppearanceStream', () => {
  const red = { r: 255, g: 0, b: 0 };
  test('縦書きの下線は列の右端のすぐ内側に細い縦線（0.75pt）、横書きは下端に横線（1pt、内側に 1pt）', () => {
    const s = markupAppearanceStream(
      'underline',
      [
        { rect: column, vertical: true },
        { rect: line, vertical: false },
      ],
      red,
      false,
    );
    expect(s).toBe('q 1 0 0 RG\n0.75 w 505.625 742 m 505.625 539 l S\n1 w 60 440 m 143 440 l S\nQ');
  });
  test('縦書きの取消線は列の左右中央に細い縦線', () => {
    expect(markupAppearanceStream('strikeout', [{ rect: column, vertical: true }], red, false)).toBe(
      'q 1 0 0 RG\n0.75 w 500 742 m 500 539 l S\nQ',
    );
  });
  test('不透明度があるときは /GS を使う', () => {
    expect(markupAppearanceStream('strikeout', [{ rect: line, vertical: false }], { r: 0, g: 0, b: 255 }, true)).toBe(
      'q /GS gs 0 0 1 RG\n1 w 60 445 m 143 445 l S\nQ',
    );
  });
});
