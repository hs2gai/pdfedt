import ja from './ja.json';
import en from './en.json';
import { appSettings, useAppSettings, type Locale } from '../app/settings';

/**
 * UI string internationalization. Strings live in src/i18n/<locale>.json and are looked up by key.
 * `{name}` placeholders are filled from params. Japanese is the default; keys without a translation fall back to it.
 * tests/unit/i18n.test.ts checks that both JSON files have the same keys and placeholders.
 */
export type MessageKey = keyof typeof ja;
type Params = Record<string, string | number>;

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
];

const messages: Record<Locale, Partial<Record<MessageKey, string>>> = { ja, en };

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const s = messages[locale][key] ?? ja[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Looks up a string in the current language (usable outside React; mounted components follow language changes via useT) */
export const t = (key: MessageKey, params?: Params): string => translate(appSettings.get().locale, key, params);

/** For components: re-renders when the language setting changes */
export function useT() {
  useAppSettings();
  return t;
}
