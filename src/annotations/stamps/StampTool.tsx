import { useEffect, useMemo, useState } from 'react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import type { PdfRuntime } from '../../pdf/engine';
import { usePlacementMode } from '../usePlacementMode';
import { createStampAnnotation } from './stamp-annotation';
import { StampPreview } from './StampPreview';
import { Icons } from '../icons';
import { useStampTemplates } from './template-store';
import {
  STAMP_COLORS,
  DATE_KEYS,
  REMEMBERED_KEYS,
  dateValues,
  templateFields,
  templateName,
  type StampData,
  type StampTemplate,
} from './template';
import { DATE_FORMATS, formatDateCustom, type DateFormat } from '../../shared/dates';
import { useT } from '../../i18n';

const MODE_ID = 'pdfa-stamp';
const SETTINGS_KEY = 'pdfa.stamp.settings';

/** Per-user defaults. Not stored in the document, only in localStorage */
interface StampSettings {
  /** Remembered fill-in values such as `{氏名}` `{部署}` */
  remembered: Record<string, string>;
  dateFormat: DateFormat;
  /** Pattern used when dateFormat is custom (Excel-like: yyyy-mm-dd aaa) */
  dateCustom: string;
  color: string;
  /** Last used template */
  template?: string;
}

const DEFAULT_SETTINGS: StampSettings = { remembered: {}, dateFormat: 'wareki', dateCustom: 'yyyy-mm-dd aaa', color: 'red' };

function loadSettings(): StampSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StampSettings>;
    return { ...DEFAULT_SETTINGS, ...s, remembered: s.remembered ?? {} };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Initial values of the template fields (remembered value if any, otherwise the default) */
function initialValues(template: StampTemplate, s: StampSettings): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of templateFields(template)) v[f.key] = s.remembered[f.key] || f.defaultValue;
  return v;
}

interface Props {
  runtime: PdfRuntime;
  documentId: string;
  active: boolean;
  onDone: () => void;
}

/** The "Stamp" tool. Pick a template and its contents in the panel, then place it where the page is clicked */
export function StampTool({ runtime, documentId, active, onDone }: Props) {
  const { provides: annotations } = useAnnotationCapability();
  const templates = useStampTemplates();
  const tr = useT();
  const [settings, setSettings] = useState<StampSettings>(loadSettings);
  const [templateId, setTemplateId] = useState<string | undefined>(settings.template);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(template, settings));
  // Custom stamps load asynchronously and the first template may change afterwards, so re-sync the values
  const templateId_ = template.id;
  useEffect(() => {
    setValues(initialValues(template, settings));
  }, [templateId_]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode etc.: do not persist */
    }
  }, [settings]);

  const fields = useMemo(() => templateFields(template).filter((f) => !DATE_KEYS.includes(f.key)), [template]);
  const hasDate = useMemo(() => templateFields(template).some((f) => DATE_KEYS.includes(f.key)), [template]);
  const dates = useMemo(
    () => dateValues(settings.dateFormat, settings.dateCustom),
    [settings.dateFormat, settings.dateCustom],
  );
  const allValues = useMemo(() => ({ ...values, ...dates }), [values, dates]);
  const data = useMemo<StampData>(
    () => ({ kind: 'stamp', template: template.id, name: template.name, values: allValues, color: settings.color }),
    [template, allValues, settings.color],
  );

  usePlacementMode(MODE_ID, documentId, active, async (p) => {
    if (!annotations) return;
    await createStampAnnotation(runtime, annotations, documentId, p.pageIndex, p.origin, template, data);
    onDone();
  });

  if (!active) return null;

  const update = (patch: Partial<StampSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const choose = (next: StampTemplate) => {
    setTemplateId(next.id);
    setValues(initialValues(next, settings));
    update({ template: next.id });
  };
  const setValue = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    // Remember name / department as the defaults for next time
    if (REMEMBERED_KEYS.includes(key)) update({ remembered: { ...settings.remembered, [key]: v } });
  };

  return (
    <div className="stamp-panel">
      <div className="stamp-grid">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`stamp-preset${t.id === template.id ? ' active' : ''}`}
            onClick={() => choose(t)}
            title={t.builtin ? tr('stamp.builtinTitle', { name: templateName(t) }) : tr('stamp.mineTitle', { name: t.name })}
          >
            {!t.builtin && (
              <span className="stamp-mine" aria-label={tr('stamp.mine')}>
                ★
              </span>
            )}
            <StampPreview
              runtime={runtime}
              template={t}
              values={{ ...initialValues(t, settings), ...dates }}
              color={settings.color}
              scale={Math.min(1.2, 56 / Math.max(t.width, t.height))}
            />
          </button>
        ))}
      </div>
      <div className="stamp-fields">
        {fields.map((f) => (
          <label key={f.key}>
            {f.key}
            <input value={values[f.key] ?? ''} onChange={(e) => setValue(f.key, e.target.value)} maxLength={20} />
          </label>
        ))}
        {hasDate && (
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
        )}
        {hasDate && settings.dateFormat === 'custom' && (
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
        <span className="swatches">
          {STAMP_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={tr(`stamp.color.${c.id}`)}
              className={c.id === settings.color ? 'swatch active' : 'swatch'}
              style={{ background: `rgb(${c.rgb.r},${c.rgb.g},${c.rgb.b})` }}
              onClick={() => update({ color: c.id })}
            />
          ))}
        </span>
      </div>
      <div className="stamp-hint">
        <span>{tr('stamp.hint')}</span>
        <button type="button" className="icon-btn" title={tr('stamp.cancel')} aria-label={tr('stamp.cancelLabel')} onClick={onDone}>
          <Icons.close />
        </button>
        <a
          href="#/stamps"
          target="_blank"
          rel="noopener"
          className="icon-btn stamp-editor-link"
          title={tr('stamp.create.help')}
          aria-label={tr('stamp.create')}
        >
          <Icons.stampNew />
        </a>
      </div>
    </div>
  );
}
