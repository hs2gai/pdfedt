import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { embedRestriction, extractSfntFace, readSfntFaces } from '../../src/pdf/fonts/sfnt';

const ttf = new Uint8Array(readFileSync('public/fonts/BIZUDPGothic-Regular.ttf'));

/** Builds a TTC bundling the same face twice (same structure as Windows' msmincho.ttc) */
function makeTtc(font: Uint8Array): Uint8Array {
  const header = 12 + 2 * 4; // 'ttcf' + version + numFonts + 2 offsets
  const faceA = header;
  const faceB = header + font.length;
  const out = new Uint8Array(header + font.length * 2);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x74746366);
  dv.setUint32(4, 0x00010000);
  dv.setUint32(8, 2);
  dv.setUint32(12, faceA);
  dv.setUint32(16, faceB);
  // Shift the table offsets of the second face (the table data is copied)
  out.set(font, faceA);
  out.set(font, faceB);
  const numTables = dv.getUint16(faceB + 4);
  for (let i = 0; i < numTables; i++) {
    const r = faceB + 12 + i * 16 + 8;
    dv.setUint32(r, dv.getUint32(r) + faceB);
  }
  for (let i = 0; i < numTables; i++) {
    const r = faceA + 12 + i * 16 + 8;
    dv.setUint32(r, dv.getUint32(r) + faceA);
  }
  return out;
}

describe('readSfntFaces', () => {
  test('単体 TTF の名前と fsType を読む', () => {
    const faces = readSfntFaces(ttf);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ index: 0, postscriptName: 'BIZUDPGothic-Regular', fullName: 'BIZ UDPGothic' });
    expect(embedRestriction(faces[0].fsType)).toBeNull(); // OFL, so embeddable
  });
  test('TTC は書体ごとに index 付きで列挙する', () => {
    const faces = readSfntFaces(makeTtc(ttf));
    expect(faces.map((f) => [f.index, f.postscriptName])).toEqual([
      [0, 'BIZUDPGothic-Regular'],
      [1, 'BIZUDPGothic-Regular'],
    ]);
  });
});

describe('extractSfntFace', () => {
  test('単体フォントはそのまま返す', () => {
    expect(extractSfntFace(ttf, 0)).toBe(ttf);
  });
  test('TTC から取り出した書体は単体の TTF として読める', () => {
    const single = extractSfntFace(makeTtc(ttf), 1);
    expect(single.length).toBeLessThan(ttf.length + 1024); // Only the copied tables (plus headroom for the header)
    expect(single.length).toBeGreaterThan(ttf.length * 0.99);
    const faces = readSfntFaces(single);
    expect(faces).toHaveLength(1);
    expect(faces[0].postscriptName).toBe('BIZUDPGothic-Regular');
    // Table order and version (sfnt version) match the original
    expect(new DataView(single.buffer).getUint32(0)).toBe(new DataView(ttf.buffer).getUint32(0));
  });
});

describe('embedRestriction（OS/2 fsType）', () => {
  test.each([
    [0x0000, null],
    [0x0008, null], // Editable
    [0x0004, null], // Preview & Print
    [0x0002, 'font.embedDenied'],
    [0x0006, null], // No restriction if bits other than 2 are set
    [0x0200, 'font.bitmapOnly'],
    [0x0100, 'font.noSubset'],
  ])('fsType=0x%s', (fsType, expected) => {
    expect(embedRestriction(fsType)).toBe(expected);
  });
});
