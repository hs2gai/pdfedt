import { describe, expect, test } from 'vitest';
import ja from '../../src/i18n/ja.json';
import en from '../../src/i18n/en.json';
import { translate } from '../../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n の辞書', () => {
  test('ja と en のキーが一致する', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });
  test('差し込み名（{name}）が両言語で一致する', () => {
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
      expect({ key, p: placeholders(en[key]) }).toEqual({ key, p: placeholders(ja[key]) });
    }
  });
  test('空の訳が無い', () => {
    for (const [k, v] of [...Object.entries(ja), ...Object.entries(en)]) expect({ k, v }).not.toEqual({ k, v: '' });
  });
});

describe('translate', () => {
  test('差し込みと言語の切り替え', () => {
    expect(translate('ja', 'save.done', { size: 12 })).toBe('保存しました（12 KB）');
    expect(translate('en', 'save.done', { size: 12 })).toBe('Saved (12 KB)');
  });
  test('無い差し込み名はそのまま残す', () => {
    expect(translate('ja', 'save.done')).toBe('保存しました（{size} KB）');
  });
});
