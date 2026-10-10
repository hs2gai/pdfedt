import { collectCodepoints, getFontSubsetter } from './subset';
import { embedRestriction, extractSfntFace, readSfntFaces } from './sfnt';
import { t } from '../../i18n';

/**
 * Uses fonts installed on the PC for content editing replacements (Local Font Access API).
 * Chrome / Edge 103+ only. The first call shows a permission dialog, so fetch the list from inside a user gesture.
 * Font bytes are received directly from the browser and never sent anywhere (they go through the same path as
 * the bundled fonts: subset to the characters needed and embedded in the PDF).
 */
export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
  }
}

export const supportsLocalFonts = (): boolean => typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

let catalog: LocalFontData[] = [];
let loading: Promise<LocalFontData[]> | null = null;

/** Fetch and keep the list. Rejects if not permitted (no permission dialog appears outside a user gesture) */
export function loadLocalFontCatalog(): Promise<LocalFontData[]> {
  if (!supportsLocalFonts()) return Promise.resolve([]);
  loading = window.queryLocalFonts!().then((fonts) => (catalog = fonts));
  return loading;
}

/** If a fetch is in progress, wait for it and return the list (used for preloading before opening a document). Failure counts as empty */
export const localFontCatalogReady = (): Promise<LocalFontData[]> => (loading ?? Promise.resolve(catalog)).catch(() => []);

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A PC font as a typeface ID: `local:<PostScript name>` (stored in annotations and stamps) */
const LOCAL_FONT_PREFIX = 'local:';
export const localFontId = (font: LocalFontData): `local:${string}` => `${LOCAL_FONT_PREFIX}${font.postscriptName}`;
export const isLocalFontId = (id: string): id is `local:${string}` => id.startsWith(LOCAL_FONT_PREFIX);
export const localFontById = (id: string, fonts = catalog): LocalFontData | undefined =>
  fonts.find((f) => f.postscriptName === id.slice(LOCAL_FONT_PREFIX.length));

/** Name hints of fonts likely usable for Japanese (a PC has hundreds of fonts, so narrow the candidates) */
const JA_HINTS =
  /[\u3040-\u30ff\u4e00-\u9fff]|mincho|gothic|meiryo|\byu\b|biz ?ud|\bipa|noto.*(jp|cjk)|source ?han|harano|sawarabi|m\+|mplus|kosugi|klee|\bzen\b|shippori|ud ?digi|\bhg[a-z]|kozuka|hiragino|jpn|japan|kyokasho|kaisho|gyosho/i;

/** PC fonts shown in the typeface picker (only those that look Japanese-capable, sorted by name) */
export function japaneseLocalFonts(fonts = catalog): LocalFontData[] {
  const seen = new Set<string>();
  return fonts
    .filter((f) => JA_HINTS.test(`${f.family} ${f.fullName}`) && !seen.has(f.postscriptName) && !!seen.add(f.postscriptName))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ja'));
}

/**
 * Finds the local font matching a PDF BaseFont (e.g. `ABCDEF+MS-Mincho`, `MS-Gothic,Bold`, `YuGothic-Regular`).
 * Strips the subset prefix; a style suffix like `,Bold` is first kept in the name
 * (an actual bold face), and dropped if that does not exist.
 */
export function findLocalFont(baseFont: string, fonts = catalog): LocalFontData | undefined {
  const [name, style] = baseFont.replace(/^[A-Z]{6}\+/, '').split(',');
  const byName = (key: string) =>
    fonts.find((f) => normalize(f.postscriptName) === key) ?? fonts.find((f) => normalize(f.fullName) === key);
  return (style ? byName(normalize(name + style)) : undefined) ?? byName(normalize(name));
}

/** An actual bold face (no synthetic bold needed) */
export const isBoldFace = (font: LocalFontData): boolean => /bold|black|heavy/i.test(font.postscriptName + font.style);

export interface LoadedFace {
  bytes: Uint8Array;
  faceIndex: number;
}

const faceCache = new Map<string, Promise<LoadedFace>>();

/** Read the font file, pick the face in a TTC, and check the embedding permission */
export function loadLocalFace(font: LocalFontData): Promise<LoadedFace> {
  let p = faceCache.get(font.postscriptName);
  if (!p) {
    p = (async () => {
      const bytes = new Uint8Array(await (await font.blob()).arrayBuffer());
      const faces = readSfntFaces(bytes);
      const key = normalize(font.postscriptName);
      const face = faces.find((f) => normalize(f.postscriptName) === key) ?? faces[0];
      const restriction = embedRestriction(face.fsType);
      if (restriction) throw new Error(`${font.fullName}: ${t(restriction)}`);
      return { bytes, faceIndex: face.index };
    })();
    faceCache.set(font.postscriptName, p);
  }
  return p;
}

/** Build a subset of a local font with only the characters in texts */
export async function subsetLocalFont(font: LocalFontData, texts: Iterable<string>): Promise<Uint8Array> {
  const [face, subsetter] = await Promise.all([loadLocalFace(font), getFontSubsetter()]);
  return subsetter.subset(face.bytes, collectCodepoints(texts), face.faceIndex);
}

/** For display: return the whole font (for a TTC, only the relevant face extracted as a single font) */
export async function loadLocalFontFace(font: LocalFontData): Promise<Uint8Array> {
  const face = await loadLocalFace(font);
  return extractSfntFace(face.bytes, face.faceIndex);
}
