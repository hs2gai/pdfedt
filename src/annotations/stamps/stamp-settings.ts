import { useEffect, useState } from 'react';
import { templateFields, type StampTemplate } from './template';
import type { DateFormat } from '../../shared/dates';

const SETTINGS_KEY = 'pdfa.stamp.settings';

/** Per-user defaults of the stamp tool. Not stored in the document, only in localStorage */
export interface StampSettings {
  /** Remembered fill-in values such as `{氏名}` `{部署}` */
  remembered: Record<string, string>;
  dateFormat: DateFormat;
  /** Pattern used when dateFormat is custom (Excel-like: yyyy-mm-dd aaa) */
  dateCustom: string;
  color: string;
  /** Last used template */
  template?: string;
}

const DEFAULT_SETTINGS: StampSettings = {
  remembered: {},
  dateFormat: 'wareki',
  dateCustom: 'yyyy-mm-dd aaa',
  color: 'red',
};

function loadSettings(): StampSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StampSettings>;
    return { ...DEFAULT_SETTINGS, ...s, remembered: s.remembered ?? {} };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The settings, written back to localStorage on every change. `update` merges a patch */
export function useStampSettings() {
  const [settings, setSettings] = useState<StampSettings>(loadSettings);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode etc.: do not persist */
    }
  }, [settings]);
  const update = (patch: Partial<StampSettings>) => setSettings((s) => ({ ...s, ...patch }));
  return { settings, update };
}

/** Initial values of the template fields (remembered value if any, otherwise the default) */
export function initialValues(template: StampTemplate, s: StampSettings): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of templateFields(template)) v[f.key] = s.remembered[f.key] || f.defaultValue;
  return v;
}
