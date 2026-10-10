import { DATE_FORMATS, formatDateCustom, type DateFormat } from '../../shared/dates';
import type { StampSettings } from './stamp-settings';
import { useT } from '../../i18n';

/** Date format of the stamp panel, with the pattern input for the custom format */
export function DateFormatFields({
  settings,
  update,
}: {
  settings: StampSettings;
  update: (patch: Partial<StampSettings>) => void;
}) {
  const tr = useT();
  return (
    <>
      <label>
        {tr('stamp.date')}
        <select value={settings.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}>
          {DATE_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {tr(`date.${f.id}`)}
            </option>
          ))}
        </select>
      </label>
      {settings.dateFormat === 'custom' && (
        <label title={tr('date.customHelp')}>
          {tr('stamp.format')}
          <input
            className="date-custom"
            value={settings.dateCustom}
            onChange={(e) => update({ dateCustom: e.target.value })}
            placeholder="yyyy-mm-dd aaa"
            spellCheck={false}
          />
          <span className="stamp-hint">→ {formatDateCustom(new Date(), settings.dateCustom)}</span>
        </label>
      )}
    </>
  );
}
