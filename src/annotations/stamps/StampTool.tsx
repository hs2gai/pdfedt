import { useEffect, useMemo, useState } from 'react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import type { PdfRuntime } from '../../pdf/engine';
import { usePlacementMode } from '../usePlacementMode';
import { createStampAnnotation, onStampEditRequest, readStampAnnotation } from './stamp-annotation';
import { stampPlacementOf } from './geometry';
import { StampPreview } from './StampPreview';
import { Icons } from '../icons';
import { IconButton } from '../IconButton';
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
import { initialValues, useStampSettings } from './stamp-settings';
import { DateFormatFields } from './DateFormatFields';
import { useT } from '../../i18n';

const MODE_ID = 'pdfa-stamp';

interface Props {
  runtime: PdfRuntime;
  documentId: string;
  active: boolean;
  onDone: () => void;
}

/** Stamp being rewritten from "Edit" in the selection menu (its own values / color; settings stay untouched) */
interface EditState {
  annotationId: string;
  templateId: string;
  values: Record<string, string>;
  color: string;
}

/**
 * The "Stamp" tool. Pick a template and its contents in the panel, then place it where the page is clicked.
 * "Edit" on a placed stamp opens the same panel with its contents (date included, kept as stamped)
 * and regenerates it at the same center, scale and rotation.
 */
export function StampTool({ runtime, documentId, active, onDone }: Props) {
  const { provides: annotations } = useAnnotationCapability();
  const templates = useStampTemplates();
  const tr = useT();
  const { settings, update } = useStampSettings();
  const [templateId, setTemplateId] = useState<string | undefined>(settings.template);
  const [edit, setEdit] = useState<EditState | null>(null);
  const editTemplate = edit ? templates.find((t) => t.id === edit.templateId) : undefined;
  const template = editTemplate ?? templates.find((t) => t.id === templateId) ?? templates[0];
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(template, settings));
  // Custom stamps load asynchronously and the first template may change afterwards, so re-sync the values
  const templateId_ = template.id;
  useEffect(() => {
    setValues(initialValues(template, settings));
  }, [templateId_]);

  useEffect(
    () =>
      onStampEditRequest(({ annotationId }) => {
        const object = annotations?.forDocument(documentId).getAnnotationById(annotationId)?.object;
        const data = object ? readStampAnnotation(object) : null;
        if (data) setEdit({ annotationId, templateId: data.template, values: { ...data.values }, color: data.color });
      }),
    [annotations, documentId],
  );

  // When editing, dates are plain fields holding the stamped value
  const fields = useMemo(
    () => templateFields(template).filter((f) => !!edit || !DATE_KEYS.includes(f.key)),
    [template, !!edit],
  );
  const hasDate = useMemo(() => templateFields(template).some((f) => DATE_KEYS.includes(f.key)), [template]);
  const dates = useMemo(
    () => dateValues(settings.dateFormat, settings.dateCustom),
    [settings.dateFormat, settings.dateCustom],
  );
  const allValues = useMemo(() => ({ ...values, ...dates }), [values, dates]);
  const shownValues = edit ? edit.values : allValues;
  const color = edit ? edit.color : settings.color;
  const data = useMemo<StampData>(
    () => ({ kind: 'stamp', template: template.id, name: template.name, values: shownValues, color }),
    [template, shownValues, color],
  );

  usePlacementMode(MODE_ID, documentId, active && !edit, async (p) => {
    if (!annotations) return;
    await createStampAnnotation(runtime, annotations, documentId, p.pageIndex, p.origin, template, data);
    onDone();
  });

  if (!active && !edit) return null;

  const choose = (next: StampTemplate) => {
    setTemplateId(next.id);
    setValues(initialValues(next, settings));
    update({ template: next.id });
  };
  const setColor = (id: string) => (edit ? setEdit({ ...edit, color: id }) : update({ color: id }));
  const setValue = (key: string, v: string) => {
    if (edit) return setEdit({ ...edit, values: { ...edit.values, [key]: v } });
    setValues((prev) => ({ ...prev, [key]: v }));
    // Remember name / department as the defaults for next time
    if (REMEMBERED_KEYS.includes(key)) update({ remembered: { ...settings.remembered, [key]: v } });
  };

  /** Create the new one first, then remove the old one (a failure keeps the original) */
  const commitEdit = async () => {
    if (!annotations || !edit || !editTemplate) return;
    const scope = annotations.forDocument(documentId);
    const old = scope.getAnnotationById(edit.annotationId)?.object;
    setEdit(null);
    if (!old) return;
    const { center, placement } = stampPlacementOf(old, editTemplate.width);
    await createStampAnnotation(
      runtime,
      annotations,
      documentId,
      old.pageIndex,
      center,
      editTemplate,
      data,
      old.author,
      placement,
    );
    scope.deleteAnnotation(old.pageIndex, old.id);
  };

  return (
    <div className="stamp-panel">
      {!edit && (
        <div className="stamp-grid">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`stamp-preset${t.id === template.id ? ' active' : ''}`}
              onClick={() => choose(t)}
              title={
                t.builtin
                  ? tr('stamp.builtinTitle', { name: templateName(t) })
                  : tr('stamp.mineTitle', { name: t.name })
              }
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
      )}
      {edit && (
        <StampPreview
          runtime={runtime}
          template={template}
          values={shownValues}
          color={color}
          scale={1.2}
          className="stamp-edit-preview"
        />
      )}
      <div className="stamp-fields">
        {fields.map((f) => (
          <label key={f.key}>
            {f.key}
            <input value={shownValues[f.key] ?? ''} onChange={(e) => setValue(f.key, e.target.value)} maxLength={20} />
          </label>
        ))}
        {hasDate && !edit && <DateFormatFields settings={settings} update={update} />}
        <span className="swatches">
          {STAMP_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={tr(`stamp.color.${c.id}`)}
              className={c.id === color ? 'swatch active' : 'swatch'}
              style={{ background: `rgb(${c.rgb.r},${c.rgb.g},${c.rgb.b})` }}
              onClick={() => setColor(c.id)}
            />
          ))}
        </span>
      </div>
      {edit ? (
        <div className="stamp-hint">
          <span>{tr('stamp.editHint')}</span>
          <span className="stamp-edit-actions">
            <IconButton icon="close" label={tr('common.cancel')} onClick={() => setEdit(null)} />
            <IconButton icon="check" label={tr('stamp.update')} className="primary" onClick={() => void commitEdit()} />
          </span>
        </div>
      ) : (
        <div className="stamp-hint">
          <span>{tr('stamp.hint')}</span>
          <button
            type="button"
            className="icon-btn"
            title={tr('stamp.cancel')}
            aria-label={tr('stamp.cancelLabel')}
            onClick={onDone}
          >
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
      )}
    </div>
  );
}
