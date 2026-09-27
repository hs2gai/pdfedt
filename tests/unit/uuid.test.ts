import { afterEach, describe, expect, test, vi } from 'vitest';
import { uuid } from '../../src/shared/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('crypto.randomUUID があればそれを使う', () => {
    expect(uuid()).toMatch(V4);
  });
  test('randomUUID が無い（http の LAN アクセスなど非 secure context）でも v4 形式で返す', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(typeof crypto.randomUUID).toBe('undefined');
    const a = uuid();
    expect(a).toMatch(V4);
    expect(uuid()).not.toBe(a);
  });
});
