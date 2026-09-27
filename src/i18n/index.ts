import ja from './ja.json';
import en from './en.json';
import { appSettings, useAppSettings, type Locale } from '../app/settings';

/**
 * UI 文字列の国際化。文字列は src/i18n/<locale>.json に置き、キーで引く。
 * `{name}` は params で差し込む。日本語が既定で、訳が無いキーは日本語にフォールバックする。
 * 両 JSON のキーと差し込み名が一致することは tests/unit/i18n.test.ts が検証する。
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

/** 現在の言語で引く（React の外からも使える。表示中のコンポーネントは useT で言語変更に追従する） */
export const t = (key: MessageKey, params?: Params): string => translate(appSettings.get().locale, key, params);

/** コンポーネント用。言語設定の変更で再描画される */
export function useT() {
  useAppSettings();
  return t;
}
