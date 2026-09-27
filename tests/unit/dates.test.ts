import { describe, expect, test } from 'vitest';
import { formatDate, formatDateCompact, formatDateCustom } from '../../src/shared/dates';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('formatDate', () => {
  test('令和は 2019-05-01 から。初年は「元年」', () => {
    expect(formatDate(d(2019, 5, 1), 'wareki')).toBe('令和元年5月1日');
    expect(formatDate(d(2026, 9, 21), 'wareki')).toBe('令和8年9月21日');
  });
  test('令和より前は西暦で返す', () => {
    expect(formatDate(d(2019, 4, 30), 'wareki')).toBe('2019年4月30日');
  });
  test('西暦・スラッシュ・なし', () => {
    expect(formatDate(d(2026, 1, 5), 'seireki')).toBe('2026年1月5日');
    expect(formatDate(d(2026, 1, 5), 'slash')).toBe('2026/01/05');
    expect(formatDate(d(2026, 1, 5), 'none')).toBe('');
  });
});

describe('formatDateCompact', () => {
  test('日付印向けの短い表記', () => {
    expect(formatDateCompact(d(2026, 9, 21), 'wareki')).toBe('R8.9.21');
    expect(formatDateCompact(d(2026, 9, 21), 'seireki')).toBe('2026.9.21');
    expect(formatDateCompact(d(2026, 9, 1), 'slash')).toBe('2026/09/01');
    expect(formatDateCompact(d(2026, 9, 21), 'none')).toBe('');
  });
});

describe('formatDateCustom（Excel 風の書式）', () => {
  const date = d(2026, 9, 21); // Monday

  test('年月日のトークン', () => {
    expect(formatDateCustom(date, 'yyyy-mm-dd')).toBe('2026-09-21');
    expect(formatDateCustom(date, 'yy/m/d')).toBe('26/9/21');
    expect(formatDateCustom(d(2026, 1, 5), 'm/d')).toBe('1/5');
  });
  test('月名・曜日（英語と日本語）', () => {
    expect(formatDateCustom(date, 'mmm d, yyyy')).toBe('Sep 21, 2026');
    expect(formatDateCustom(date, 'mmmm')).toBe('September');
    expect(formatDateCustom(date, 'ddd / dddd')).toBe('Mon / Monday');
    expect(formatDateCustom(date, 'aaa / aaaa')).toBe('月 / 月曜日');
  });
  test('元号（令和・平成・昭和）と和暦年', () => {
    expect(formatDateCustom(date, 'ggge年m月d日')).toBe('令和8年9月21日');
    expect(formatDateCustom(date, 'gge.m.d')).toBe('令8.9.21');
    expect(formatDateCustom(date, 'gee')).toBe('R08');
    expect(formatDateCustom(d(2019, 4, 30), 'ggge年')).toBe('平成31年');
    expect(formatDateCustom(d(1989, 1, 7), 'ggge年')).toBe('昭和64年');
    expect(formatDateCustom(d(1989, 1, 8), 'ggge年')).toBe('平成1年');
  });
  test('大文字のトークンも同じ扱い', () => {
    expect(formatDateCustom(date, 'YYYY-MM-DD')).toBe('2026-09-21');
  });
  test('二重引用符で囲んだ文字はそのまま。トークン以外の文字も素通し', () => {
    expect(formatDateCustom(date, '"承認" yyyy年')).toBe('承認 2026年');
    expect(formatDateCustom(date, 'yyyy年m月d日（aaa）')).toBe('2026年9月21日（月）');
    expect(formatDateCustom(date, '"未閉じ')).toBe('未閉じ');
  });
  test('空の書式は空文字', () => {
    expect(formatDateCustom(date, '')).toBe('');
  });
});
