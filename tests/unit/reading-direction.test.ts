import { describe, expect, test } from 'vitest';
import { neutralPreferencesPdf } from '../../src/pdf/reading-direction';

describe('neutralPreferencesPdf', () => {
  const text = new TextDecoder().decode(neutralPreferencesPdf());

  test('カタログに左綴じ（/Direction /L2R）だけを持つ', () => {
    expect(text).toMatch(/1 0 obj\n<<\/Type\/Catalog\/Pages 2 0 R\/ViewerPreferences<<\/Direction\/L2R>>>>/);
    expect(text).not.toContain('R2L');
  });

  test('xref の各オフセットが該当するオブジェクトの先頭を指し、startxref が xref を指す', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(2);
    entries.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(text).toContain('trailer\n<</Size 3/Root 1 0 R>>');
  });
});
