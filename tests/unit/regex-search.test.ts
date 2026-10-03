import { expect, test } from 'vitest';
import { compileSearchRegex, findRegexMatches, regexError } from '../../src/pdf/regex-search';

test('findRegexMatches: 一致の位置と長さを UTF-16 単位で返す', () => {
  const re = compileSearchRegex('第\\d+条', false);
  expect(findRegexMatches('第1条と第12条', re)).toEqual([
    { index: 0, length: 3 },
    { index: 4, length: 4 },
  ]);
});

test('findRegexMatches: matchCase でなければ大文字小文字を区別しない', () => {
  expect(findRegexMatches('Page page PAGE', compileSearchRegex('page', false))).toHaveLength(3);
  expect(findRegexMatches('Page page PAGE', compileSearchRegex('page', true))).toEqual([{ index: 5, length: 4 }]);
});

test('findRegexMatches: 空一致は飛ばし、件数は上限で打ち切る', () => {
  expect(findRegexMatches('abc', compileSearchRegex('x*', false))).toEqual([]);
  expect(findRegexMatches('a'.repeat(50), compileSearchRegex('a', false), 10)).toHaveLength(10);
});

test('findRegexMatches: 改行をまたぐ一致や Unicode プロパティも使える', () => {
  expect(findRegexMatches('行末\r\n行頭', compileSearchRegex('末\\s+行', false))).toEqual([{ index: 1, length: 4 }]);
  expect(findRegexMatches('ABCかなカナ', compileSearchRegex('\\p{Script=Hiragana}+', false))).toEqual([{ index: 3, length: 2 }]);
});

test('regexError: 不正なパターンはメッセージ、正しければ null', () => {
  expect(regexError('ページ[AB]')).toBeNull();
  expect(regexError('(')).toEqual(expect.any(String));
  expect(regexError('[')).toEqual(expect.any(String));
});
