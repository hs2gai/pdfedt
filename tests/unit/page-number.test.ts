import { expect, test } from 'vitest';
import { parsePageNumber } from '../../src/viewer/page-number';

test('parsePageNumber: 範囲内はそのまま、範囲外は端に寄せ、全角数字も受け付ける', () => {
  expect(parsePageNumber('3', 12)).toBe(3);
  expect(parsePageNumber(' 7 ', 12)).toBe(7);
  expect(parsePageNumber('99', 12)).toBe(12);
  expect(parsePageNumber('0', 12)).toBe(1);
  expect(parsePageNumber('-5', 12)).toBe(1);
  expect(parsePageNumber('１２', 12)).toBe(12);
});

test('parsePageNumber: 数字でなければ null', () => {
  expect(parsePageNumber('', 12)).toBeNull();
  expect(parsePageNumber('abc', 12)).toBeNull();
  expect(parsePageNumber('3', 0)).toBeNull();
});
