import { describe, expect, it } from 'vitest';
import { stampPlacementOf, stampRects } from '../../src/annotations/stamps/geometry';
import { channel } from '../../src/shared/channel';

describe('stampRects', () => {
  it('回転なし・等倍は中心に設計どおりの大きさで置く', () => {
    expect(stampRects({ x: 100, y: 50 }, { width: 40, height: 20 })).toEqual({
      rect: { origin: { x: 80, y: 40 }, size: { width: 40, height: 20 } },
    });
  });

  it('倍率は中心を保ったまま縦横に掛かる', () => {
    expect(stampRects({ x: 100, y: 50 }, { width: 40, height: 20 }, { scale: 1.5 }).rect).toEqual({
      origin: { x: 70, y: 35 },
      size: { width: 60, height: 30 },
    });
  });

  it('90 度回すと rect は縦横が入れ替わった外接矩形、unrotatedRect は元の矩形になる', () => {
    const r = stampRects({ x: 100, y: 50 }, { width: 40, height: 20 }, { rotation: 90 });
    expect(r.rotation).toBe(90);
    expect(r.unrotatedRect).toEqual({ origin: { x: 80, y: 40 }, size: { width: 40, height: 20 } });
    expect(r.rect.size.width).toBeCloseTo(20);
    expect(r.rect.size.height).toBeCloseTo(40);
    expect(r.rect.origin.x + r.rect.size.width / 2).toBeCloseTo(100);
    expect(r.rect.origin.y + r.rect.size.height / 2).toBeCloseTo(50);
  });

  it('360 度は回転なしとして扱う', () => {
    expect(stampRects({ x: 0, y: 0 }, { width: 10, height: 10 }, { rotation: 360 }).unrotatedRect).toBeUndefined();
  });
});

describe('stampPlacementOf', () => {
  it('拡大・回転したスタンプから中心・倍率・回転を取り出し、作り直すと同じ矩形になる', () => {
    const placed = stampRects({ x: 200, y: 300 }, { width: 40, height: 40 }, { scale: 2, rotation: 30 });
    const { center, placement } = stampPlacementOf(placed, 40);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(300);
    expect(placement).toEqual({ scale: 2, rotation: 30 });
    expect(stampRects(center, { width: 40, height: 40 }, placement)).toEqual(placed);
  });

  it('回転していないスタンプは rect から求める', () => {
    const { center, placement } = stampPlacementOf(
      { rect: { origin: { x: 10, y: 20 }, size: { width: 84, height: 38 } } },
      84,
    );
    expect(center).toEqual({ x: 52, y: 39 });
    expect(placement).toEqual({ scale: 1, rotation: 0 });
  });
});

describe('channel', () => {
  it('登録中の受け手すべてに届き、解除後は届かない', () => {
    const ch = channel<number>();
    const got: number[] = [];
    const off = ch.on((v) => got.push(v));
    ch.on((v) => got.push(v * 10));
    ch.emit(1);
    off();
    ch.emit(2);
    expect(got).toEqual([1, 10, 20]);
  });
});
