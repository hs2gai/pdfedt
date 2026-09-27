import { useSyncExternalStore } from 'react';

export type Locale = 'ja' | 'en';

/** App display settings (localStorage; not stored in the document) */
export interface AppSettings {
  /** UI language (default Japanese; strings in src/i18n/*.json) */
  locale: Locale;
  /** Animate scrolling when navigating to a page from thumbnails etc. */
  smoothScroll: boolean;
  /** Show form fields in light blue */
  highlightFields: boolean;
  /** Use PC fonts for content editing replacements (browsers with the Local Font Access API only) */
  localFonts: boolean;
  /** Auto-open the first "recent file" at startup */
  autoResume: boolean;
  /** Last used tool per toolbar group (markup / shape) */
  groupTools: Record<string, string>;
}

const KEY = 'pdfa.settings';
const DEFAULTS: AppSettings = {
  locale: 'ja',
  smoothScroll: false,
  highlightFields: true,
  localFonts: false,
  autoResume: true,
  groupTools: {},
};

function load(): AppSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export const appSettings = {
  get: () => current,
  set(patch: Partial<AppSettings>) {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* private mode etc.: do not persist */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(appSettings.subscribe, appSettings.get);
}
