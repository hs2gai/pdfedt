import { describe, expect, it } from 'vitest';
import { area, contains, encloses, rectFrom } from '../../src/content-edit/rect';
import { isLockedBySignature, type DocumentInfo } from '../../src/pdf/inspector';

const r = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe('rect', () => {
  it('area は幅×高さ', () => {
    expect(area(r(5, 5, 4, 3))).toBe(12);
  });

  it('contains は辺の上も内側とみなす', () => {
    expect(contains(r(0, 0, 10, 10), { x: 10, y: 0 })).toBe(true);
    expect(contains(r(0, 0, 10, 10), { x: 10.1, y: 5 })).toBe(false);
  });

  it('encloses は内側の矩形が丸ごと収まるときだけ true', () => {
    expect(encloses(r(0, 0, 10, 10), r(2, 2, 8, 8))).toBe(true);
    expect(encloses(r(0, 0, 10, 10), r(2, 2, 9, 8))).toBe(false);
  });

  it('rectFrom は 2 点の順序によらず同じ矩形を返す', () => {
    expect(rectFrom({ x: 8, y: 1 }, { x: 2, y: 5 })).toEqual(r(2, 1, 6, 4));
    expect(rectFrom({ x: 2, y: 5 }, { x: 8, y: 1 })).toEqual(r(2, 1, 6, 4));
  });
});

describe('isLockedBySignature', () => {
  const info = (signatures: number, docMdp: DocumentInfo['docMdp']) => ({ signatures, docMdp }) as DocumentInfo;

  it('署名が変更を禁じる DocMDP 1・2 だけロックする', () => {
    expect(isLockedBySignature(info(1, 1))).toBe(true);
    expect(isLockedBySignature(info(1, 2))).toBe(true);
    expect(isLockedBySignature(info(1, 3))).toBe(false);
    expect(isLockedBySignature(info(1, 0))).toBe(false);
  });

  it('署名が無い・情報が無いときはロックしない', () => {
    expect(isLockedBySignature(info(0, 1))).toBe(false);
    expect(isLockedBySignature(null)).toBe(false);
  });
});
