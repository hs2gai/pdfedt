import { describe, expect, test } from 'vitest';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { isCopyable, pasteOffset, translateAnnotation, unionRect } from '../../src/annotations/clipboard-geometry';
import { unrotateExportedAppearance } from '../../src/pdf/appearance-matrix';

const rect = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe('translateAnnotation', () => {
  test('rect と種類ごとの座標（手書き・頂点・線・マーカー・引き出し線）をまとめてずらす', () => {
    const a = {
      type: PdfAnnotationSubtype.INK,
      id: 'a',
      pageIndex: 0,
      rect: rect(10, 20, 30, 40),
      unrotatedRect: rect(12, 22, 26, 36),
      inkList: [{ points: [{ x: 10, y: 20 }, { x: 40, y: 60 }] }],
      vertices: [{ x: 1, y: 2 }],
      linePoints: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 } },
      segmentRects: [rect(0, 0, 10, 2)],
      calloutLine: [{ x: 3, y: 4 }],
    } as unknown as PdfAnnotationObject;
    const moved = translateAnnotation(a, 5, -10) as unknown as Record<string, unknown>;
    expect(moved.rect).toEqual(rect(15, 10, 30, 40));
    expect(moved.unrotatedRect).toEqual(rect(17, 12, 26, 36));
    expect(moved.inkList).toEqual([{ points: [{ x: 15, y: 10 }, { x: 45, y: 50 }] }]);
    expect(moved.vertices).toEqual([{ x: 6, y: -8 }]);
    expect(moved.linePoints).toEqual({ start: { x: 5, y: -10 }, end: { x: 10, y: -5 } });
    expect(moved.segmentRects).toEqual([rect(5, -10, 10, 2)]);
    expect(moved.calloutLine).toEqual([{ x: 8, y: -6 }]);
    // The original is left as is
    expect(a.rect).toEqual(rect(10, 20, 30, 40));
  });
});

test('isCopyable: リンク・フォーム部品・ポップアップは複製しない', () => {
  const of = (type: PdfAnnotationSubtype) => ({ type }) as PdfAnnotationObject;
  expect(isCopyable(of(PdfAnnotationSubtype.STAMP))).toBe(true);
  expect(isCopyable(of(PdfAnnotationSubtype.HIGHLIGHT))).toBe(true);
  expect(isCopyable(of(PdfAnnotationSubtype.LINK))).toBe(false);
  expect(isCopyable(of(PdfAnnotationSubtype.WIDGET))).toBe(false);
  expect(isCopyable(of(PdfAnnotationSubtype.POPUP))).toBe(false);
});

describe('pasteOffset', () => {
  const page = { width: 600, height: 800 };
  test('ページ内に収まるときは指定どおり右下へずらす', () => {
    expect(pasteOffset(rect(100, 100, 50, 50), page, 10)).toEqual({ dx: 10, dy: 10 });
  });
  test('はみ出す分は手前で止める', () => {
    expect(pasteOffset(rect(545, 795, 50, 5), page, 10)).toEqual({ dx: 5, dy: 0 });
  });
  test('ページより大きいときは左上をページに合わせる', () => {
    expect(pasteOffset(rect(-20, 30, 700, 50), page, 10)).toEqual({ dx: 20, dy: 10 });
  });
  test('複数の注釈は外接矩形でまとめて扱う', () => {
    expect(unionRect([rect(10, 20, 30, 40), rect(100, 5, 10, 10)])).toEqual(rect(10, 5, 100, 55));
  });
});

describe('unrotateExportedAppearance', () => {
  const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const dec = (b: Uint8Array) => String.fromCharCode(...b);
  const matrix = '/Matrix[ .0000000119248806 -1 1 .0000000119248806 -260.49442 841.88977]';
  const pdf = (m: string) =>
    `%PDF-1.7\r\n%\xa1\xb3\x85\x9f\r\n` +
    `4 0 obj\r\n<</BBox[ 0 0 84 38]/EPDFOrigContentRect[ 0 0 84 38]/Length 1${m}/Subtype/Form>>stream\r\nq\r\nendstream\r\nendobj\r\n` +
    `5 0 obj\r\n<</BBox[ 0 0 84 38]/Matrix[0 1 -1 0 0 0]/Subtype/Form>>stream\r\nQ\r\nendstream\r\nendobj\r\n`;

  test('回転用ラッパーの /Matrix から回転だけを外し、平行移動とバイト長は保つ', () => {
    const input = enc(pdf(matrix));
    const out = unrotateExportedAppearance(input);
    expect(out.length).toBe(input.length);
    const text = dec(out);
    expect(text).toContain('/Matrix[1 0 0 1 -260.49442 841.88977]');
    expect(text).not.toContain(matrix);
    // Other forms and binary bytes are untouched
    expect(text).toContain('/Matrix[0 1 -1 0 0 0]');
    expect(out.subarray(0, 16)).toEqual(input.subarray(0, 16));
    expect(input).toEqual(enc(pdf(matrix)));
  });

  test('ラッパーが無ければそのまま返す', () => {
    const input = enc('%PDF-1.7\r\n4 0 obj\r\n<</Matrix[0 1 -1 0 0 0]>>stream\r\nendstream\r\nendobj\r\n');
    expect(unrotateExportedAppearance(input)).toBe(input);
  });
});
