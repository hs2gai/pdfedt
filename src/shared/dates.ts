export type DateFormat = 'wareki' | 'seireki' | 'slash' | 'custom' | 'none';

/** Date format options. Labels come from i18n: date.<id> */
export const DATE_FORMATS: { id: DateFormat }[] = [{ id: 'wareki' }, { id: 'seireki' }, { id: 'slash' }, { id: 'custom' }, { id: 'none' }];

/** Reiwa only (2019-05-01 onwards). Earlier dates are returned in the Western calendar */
export function formatDate(date: Date, format: DateFormat): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  switch (format) {
    case 'wareki': {
      if (date >= new Date(2019, 4, 1)) {
        const r = y - 2018;
        return `令和${r === 1 ? '元' : r}年${m}月${d}日`;
      }
      return `${y}年${m}月${d}日`;
    }
    case 'seireki':
      return `${y}年${m}月${d}日`;
    case 'slash':
      return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    case 'custom':
      // Custom patterns are formatted by formatDateCustom (Western calendar here)
      return `${y}年${m}月${d}日`;
    case 'none':
      return '';
  }
}

/** Short form for date stamps ('26. 9.20 / R8.9.20 etc.) */
export function formatDateCompact(date: Date, format: DateFormat): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (format === 'none') return '';
  if (format === 'wareki' && date >= new Date(2019, 4, 1)) return `R${y - 2018}.${m}.${d}`;
  if (format === 'slash') return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  return `${y}.${m}.${d}`;
}

// ---------------------------------------------------------------------------
// Custom pattern (follows Excel date formats)

/** Japanese eras (newest start date first) */
const ERAS: { name: string; short: string; letter: string; start: Date }[] = [
  { name: '令和', short: '令', letter: 'R', start: new Date(2019, 4, 1) },
  { name: '平成', short: '平', letter: 'H', start: new Date(1989, 0, 8) },
  { name: '昭和', short: '昭', letter: 'S', start: new Date(1926, 11, 25) },
  { name: '大正', short: '大', letter: 'T', start: new Date(1912, 6, 30) },
  { name: '明治', short: '明', letter: 'M', start: new Date(1868, 0, 25) },
];
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Match longer tokens first */
const TOKENS = ['yyyy', 'yy', 'mmmm', 'mmm', 'mm', 'm', 'dddd', 'ddd', 'dd', 'd', 'aaaa', 'aaa', 'ggg', 'gg', 'g', 'ee', 'e'];

/**
 * Formats a date with an Excel-like pattern (yyyy-mm-dd aaa → 2026-09-21 月, ggge年m月d日 → 令和8年9月21日).
 * Text in double quotes is output literally.
 */
export function formatDateCustom(date: Date, pattern: string): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const wd = date.getDay();
  const era = ERAS.find((e) => date >= e.start);
  const eraYear = era ? y - era.start.getFullYear() + 1 : y;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const value = (t: string): string => {
    switch (t) {
      case 'yyyy':
        return String(y);
      case 'yy':
        return pad2(y % 100);
      case 'mmmm':
        return MONTHS_EN[m - 1];
      case 'mmm':
        return MONTHS_EN[m - 1].slice(0, 3);
      case 'mm':
        return pad2(m);
      case 'm':
        return String(m);
      case 'dddd':
        return WEEKDAYS_EN[wd];
      case 'ddd':
        return WEEKDAYS_EN[wd].slice(0, 3);
      case 'dd':
        return pad2(d);
      case 'd':
        return String(d);
      case 'aaaa':
        return `${WEEKDAYS_JA[wd]}曜日`;
      case 'aaa':
        return WEEKDAYS_JA[wd];
      case 'ggg':
        return era?.name ?? '';
      case 'gg':
        return era?.short ?? '';
      case 'g':
        return era?.letter ?? '';
      case 'ee':
        return pad2(eraYear);
      case 'e':
        return String(eraYear);
      default:
        return t;
    }
  };
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '"') {
      const end = pattern.indexOf('"', i + 1);
      out += pattern.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    const lower = pattern.slice(i).toLowerCase();
    const token = TOKENS.find((t) => lower.startsWith(t));
    if (token) {
      out += value(token);
      i += token.length;
    } else {
      out += pattern[i];
      i += 1;
    }
  }
  return out;
}
