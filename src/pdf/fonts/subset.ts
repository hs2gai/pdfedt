import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

/** Raw exports of harfbuzz-subset.wasm (only what we need) */
interface HbSubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, lengthOut: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_FLAGS_NO_HINTING = 1 << 0;

export interface FontSubsetter {
  /** Returns a font keeping only the characters in codepoints (TTF/OTF; for a TTC, faceIndex picks the face) */
  subset(font: Uint8Array, codepoints: Iterable<number>, faceIndex?: number): Uint8Array;
}

export async function createFontSubsetter(): Promise<FontSubsetter> {
  const bytes = await (await fetch(subsetWasmUrl)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const hb = instance.exports as unknown as HbSubsetExports;
  const heap = () => new Uint8Array(hb.memory.buffer); // Invalidated after grow, so fetch it every time

  return {
    subset(font, codepoints, faceIndex = 0) {
      const fontPtr = hb.malloc(font.byteLength);
      heap().set(font, fontPtr);
      const blob = hb.hb_blob_create(fontPtr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
      const face = hb.hb_face_create(blob, faceIndex);
      hb.hb_blob_destroy(blob);

      const input = hb.hb_subset_input_create_or_fail();
      if (!input) throw new Error('hb_subset_input_create_or_fail');
      hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
      const unicodes = hb.hb_subset_input_unicode_set(input);
      for (const cp of codepoints) hb.hb_set_add(unicodes, cp);

      const subsetFace = hb.hb_subset_or_fail(face, input);
      if (!subsetFace) {
        hb.hb_subset_input_destroy(input);
        hb.hb_face_destroy(face);
        hb.free(fontPtr);
        throw new Error('hb_subset_or_fail');
      }
      const out = hb.hb_face_reference_blob(subsetFace);
      const len = hb.hb_blob_get_length(out);
      const ptr = hb.hb_blob_get_data(out, 0);
      const result = heap().slice(ptr, ptr + len);

      hb.hb_blob_destroy(out);
      hb.hb_face_destroy(subsetFace);
      hb.hb_subset_input_destroy(input);
      hb.hb_face_destroy(face);
      hb.free(fontPtr);
      return result;
    },
  };
}

/** Build a unique set of code points from strings */
export function collectCodepoints(texts: Iterable<string>): Set<number> {
  const set = new Set<number>();
  for (const t of texts) for (const ch of t) set.add(ch.codePointAt(0)!);
  return set;
}

let shared: Promise<FontSubsetter> | null = null;
/** harfbuzz-subset is initialized once and shared by the bundled fonts and PC fonts */
export function getFontSubsetter(): Promise<FontSubsetter> {
  return (shared ??= createFontSubsetter());
}
