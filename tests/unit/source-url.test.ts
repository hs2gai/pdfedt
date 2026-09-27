import { describe, expect, test } from 'vitest';
import { fileNameFor, looksLikePdf, sourceUrlOf } from '../../src/app/source-url';

describe('sourceUrlOf', () => {
  test('#src= の後ろを URL としてそのまま返す（? や & を含む）', () => {
    expect(sourceUrlOf('#src=https://example.com/a.pdf?x=1&y=2')).toBe('https://example.com/a.pdf?x=1&y=2');
    expect(sourceUrlOf('#src=file:///C:/docs/a.pdf')).toBe('file:///C:/docs/a.pdf');
  });
  test('別のハッシュや空は対象外', () => {
    expect(sourceUrlOf('')).toBeNull();
    expect(sourceUrlOf('#/stamps')).toBeNull();
  });
});

describe('fileNameFor', () => {
  test('URL のパス末尾（パーセントエンコード解除）', () => {
    expect(fileNameFor('https://example.com/docs/%E8%A6%8B%E7%A9%8D.pdf?dl=1', null)).toBe('見積.pdf');
    expect(fileNameFor('file:///C:/docs/a.PDF', undefined)).toBe('a.PDF');
  });
  test('Content-Disposition の filename* を最優先、次に filename', () => {
    expect(
      fileNameFor('https://x/dl?id=1', 'inline; filename="fallback.pdf"; filename*=UTF-8\'\'%E8%AB%8B%E6%B1%82.pdf'),
    ).toBe('請求.pdf');
    expect(fileNameFor('https://x/dl?id=1', 'inline; filename="report.pdf"')).toBe('report.pdf');
  });
  test('拡張子が無ければ .pdf を付け、使えない文字は置き換える', () => {
    expect(fileNameFor('https://x/dl?id=1', null)).toBe('dl.pdf');
    expect(fileNameFor('https://x/', null)).toBe('document.pdf');
    expect(fileNameFor('https://x/dl', 'inline; filename="a:b.pdf"')).toBe('a_b.pdf');
  });
});

describe('looksLikePdf', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  test('先頭、または 1024 バイト以内に %PDF- があれば PDF', () => {
    expect(looksLikePdf(enc('%PDF-1.7\n%âãÏÓ'))).toBe(true);
    expect(looksLikePdf(new Uint8Array([...new Uint8Array(1000), ...enc('%PDF-1.4')]))).toBe(true);
  });
  test('HTML や空は PDF でない', () => {
    expect(looksLikePdf(enc('<!doctype html><title>x</title>'))).toBe(false);
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
    expect(looksLikePdf(new Uint8Array([...new Uint8Array(2000), ...enc('%PDF-1.4')]))).toBe(false);
  });
});
