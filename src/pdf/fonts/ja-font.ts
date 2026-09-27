import { getFontSubsetter, collectCodepoints } from './subset';
import { DEFAULT_FONT_ID, bundledFontInfo, fontLabel, type BundledFontId, type FontId } from './catalog';
import { isLocalFontId, loadLocalFace, localFontById } from './local-fonts';
import { t } from '../../i18n';

/**
 * Bundled Japanese fonts (OFL). Used for annotation text.
 * The full font is fetched once per typeface; each annotation embeds a subset with only the glyphs it needs.
 */
export interface JaFont {
  subsetFor(texts: Iterable<string>): Uint8Array;
}

const bytesCache = new Map<BundledFontId, Promise<Uint8Array>>();
const fontCache = new Map<FontId, Promise<JaFont>>();

/** Bytes of a bundled font (used both as display fallback and for annotation subsets) */
export function loadJaFontBytes(id: BundledFontId = DEFAULT_FONT_ID): Promise<Uint8Array> {
  let p = bytesCache.get(id);
  if (!p) {
    // Fetch public/fonts/ from the same origin (CSP: connect-src 'self')
    p = fetch(`/fonts/${bundledFontInfo(id).file}`).then(async (r) => {
      if (!r.ok) throw new Error(t('font.fetchFailed', { label: fontLabel(id), status: r.status }));
      return new Uint8Array(await r.arrayBuffer());
    });
    bytesCache.set(id, p);
  }
  return p;
}

/** A bundled font, or a PC font (`local:` ID). Fonts missing on this PC fall back to the default typeface */
export function loadJaFont(id: FontId = DEFAULT_FONT_ID): Promise<JaFont> {
  let p = fontCache.get(id);
  if (!p) {
    p = (async () => {
      if (isLocalFontId(id)) {
        const font = localFontById(id);
        if (!font) {
          console.warn(`PC font not found; using the default typeface: ${id}`);
          return loadJaFont(DEFAULT_FONT_ID);
        }
        const [face, subsetter] = await Promise.all([loadLocalFace(font), getFontSubsetter()]);
        return { subsetFor: (texts) => subsetter.subset(face.bytes, collectCodepoints(texts), face.faceIndex) };
      }
      const [full, subsetter] = await Promise.all([loadJaFontBytes(id), getFontSubsetter()]);
      return { subsetFor: (texts) => subsetter.subset(full, collectCodepoints(texts)) };
    })();
    fontCache.set(id, p);
  }
  return p;
}

/** Per typeface, build a subset with only the characters drawn in it (for multi-typeface appearances such as stamps) */
export async function subsetFonts(textsByFont: Map<FontId, string[]>): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  await Promise.all(
    [...textsByFont].map(async ([id, texts]) => {
      out[id] = (await loadJaFont(id)).subsetFor(texts);
    }),
  );
  return out;
}
