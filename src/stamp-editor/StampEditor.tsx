import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { PdfRuntime } from '../pdf/engine';
import { StampPreview } from '../annotations/stamps/StampPreview';
import { Icons } from '../annotations/icons';
import {
  STAMP_COLORS,
  dateValues,
  templateFields,
  templateName,
  type StampElement,
  type StampTemplate,
  type TextElement,
} from '../annotations/stamps/template';
import {
  putTemplate,
  removeTemplate,
  templatesFromJson,
  templatesToJson,
  useStampTemplates,
} from '../annotations/stamps/template-store';
import { JSON_TYPE, pickSaveTarget, writeSaveTarget } from '../pdf/download';
import { StampCanvas, moveElement } from './StampCanvas';
import { ElementProps } from './ElementProps';
import { Brand } from '../app/Brand';
import { uuid } from '../shared/uuid';
import { t as tr0, useT } from '../i18n';

const SCALE = 5;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newId = () => uuid();

/** Values filled into the preview: the default if any, otherwise the label itself (so the field is recognizable) */
function previewValues(t: StampTemplate): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of templateFields(t)) v[f.key] = f.defaultValue || f.key;
  return { ...v, ...dateValues('wareki') };
}

function blankTemplate(): StampTemplate {
  return {
    id: newId(),
    name: tr0('se.newName'),
    width: 60,
    height: 60,
    color: 'red',
    updatedAt: 0,
    elements: [{ id: newId(), type: 'rect', x: 0, y: 0, w: 60, h: 60, radius: 0, strokeWidth: 1.4, fill: false }],
  };
}

/** Initial shape of an added element (placed at the canvas center) */
function newElement(kind: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'text', t: StampTemplate): StampElement {
  const cx = t.width / 2;
  const cy = t.height / 2;
  const w = Math.min(30, t.width * 0.6);
  const h = Math.min(16, t.height * 0.6);
  const base = { id: newId(), x: cx - w / 2, y: cy - h / 2, w, h };
  switch (kind) {
    case 'rect':
      return { ...base, type: 'rect', radius: 0, strokeWidth: 1.4, fill: false };
    case 'roundRect':
      return { ...base, type: 'rect', radius: 4, strokeWidth: 1.4, fill: false };
    case 'ellipse':
      return { ...base, type: 'ellipse', strokeWidth: 1.4, fill: false };
    case 'line':
      return { id: base.id, type: 'line', x1: cx - w / 2, y1: cy, x2: cx + w / 2, y2: cy, strokeWidth: 1.1 };
    case 'text':
      return { ...base, type: 'text', text: tr0('se.textDefault'), fontSize: 12, vertical: false, align: 'center' };
  }
}

/** Stamp editor screen (#/stamps). Left: list, center: canvas, right: properties */
export function StampEditor({ runtime }: { runtime: PdfRuntime }) {
  const templates = useStampTemplates();
  const [draft, setDraft] = useState<StampTemplate>(() => clone(templates[0]));
  const [sourceId, setSourceId] = useState<string | null>(templates[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const tr = useT();

  const source = templates.find((t) => t.id === sourceId);
  const isBuiltin = !!source?.builtin;
  const values = useMemo(() => previewValues(draft), [draft]);
  const selected = draft.elements.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    const prev = document.title;
    document.title = tr0('se.docTitle');
    return () => {
      document.title = prev;
    };
  }, []);

  const edit = (patch: Partial<StampTemplate> | ((t: StampTemplate) => StampTemplate)) => {
    setDraft((t) => (typeof patch === 'function' ? patch(t) : { ...t, ...patch }));
    setDirty(true);
  };
  const editElement = (el: StampElement) =>
    edit((t) => ({ ...t, elements: t.elements.map((e) => (e.id === el.id ? el : e)) }));

  const confirmDiscard = () => !dirty || window.confirm(tr('se.confirmDiscard'));
  const load = (t: StampTemplate) => {
    if (!confirmDiscard()) return;
    setDraft(clone(t));
    setSourceId(t.id);
    setSelectedId(null);
    setDirty(false);
  };
  const startNew = () => {
    if (!confirmDiscard()) return;
    setDraft(blankTemplate());
    setSourceId(null);
    setSelectedId(null);
    setDirty(true);
  };
  /** Start editing a built-in or saved stamp as a copy with a new ID */
  const duplicate = () => {
    const copy = clone(draft);
    copy.id = newId();
    copy.name = tr('se.copyName', { name: templateName(draft) });
    copy.builtin = undefined;
    copy.elements = copy.elements.map((e) => ({ ...e, id: newId() }));
    setDraft(copy);
    setSourceId(null);
    setDirty(true);
  };
  const save = async () => {
    // Built-ins cannot be overwritten, so save as a copy
    const t = isBuiltin ? { ...draft, id: newId(), builtin: undefined } : draft;
    await putTemplate(t);
    setDraft(t);
    setSourceId(t.id);
    setDirty(false);
    setStatus(tr('se.saved', { name: t.name }));
  };
  const remove = async () => {
    if (!source || isBuiltin) return;
    if (!window.confirm(tr('se.confirmDelete', { name: source.name }))) return;
    await removeTemplate(source.id);
    startNewAfterRemove();
  };
  const startNewAfterRemove = () => {
    setDraft(blankTemplate());
    setSourceId(null);
    setSelectedId(null);
    setDirty(false);
  };

  const addElement = (kind: Parameters<typeof newElement>[0]) => {
    const el = newElement(kind, draft);
    edit((t) => ({ ...t, elements: [...t.elements, el] }));
    setSelectedId(el.id);
  };
  const removeSelected = () => {
    if (!selected) return;
    edit((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== selected.id) }));
    setSelectedId(null);
  };
  const reorder = (dir: -1 | 1) => {
    if (!selected) return;
    edit((t) => {
      const i = t.elements.indexOf(selected);
      const j = i + dir;
      if (j < 0 || j >= t.elements.length) return t;
      const next = [...t.elements];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...t, elements: next };
    });
  };

  // Keyboard: arrows move (Shift = 5pt), Delete removes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement).matches('input, textarea, select')) return;
      const step = e.shiftKey ? 5 : 0.5;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (d[e.key]) {
        e.preventDefault();
        editElement(moveElement(selected, ...d[e.key]));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportJson = async () => {
    const mine = templates.filter((t) => !t.builtin);
    if (mine.length === 0) {
      setStatus(tr('se.nothingToExport'));
      return;
    }
    const target = await pickSaveTarget('stamps.json', JSON_TYPE);
    if (target.kind === 'cancelled') return;
    await writeSaveTarget(target, templatesToJson(mine), JSON_TYPE);
    setStatus(tr('se.exported', { count: mine.length }));
  };
  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const list = templatesFromJson(await f.text());
      for (const t of list) await putTemplate(t);
      setStatus(tr('se.imported', { count: list.length }));
    } catch (err) {
      setStatus(tr('se.importFailed', { message: (err as Error).message }));
    }
  };

  const textElements = draft.elements.filter((e): e is TextElement => e.type === 'text');
  const fields = templateFields(draft);

  return (
    <div className="stamp-editor">
      <header className="se-header">
        <Brand />
        <span className="sep" />
        <strong>{tr('se.title')}</strong>
        <button onClick={startNew}>{tr('se.new')}</button>
        <button onClick={() => fileInput.current?.click()}>{tr('se.import')}</button>
        <button onClick={exportJson}>{tr('se.export')}</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importJson} />
        <span className="se-status">{status}</span>
        <a href="#/" className="icon-btn se-back" title={tr('se.back')} aria-label={tr('se.back')}>
          <Icons.back />
        </a>
      </header>
      <div className="se-body">
        <aside className="se-list">
          <h3>{tr('se.mine')}</h3>
          {templates.filter((t) => !t.builtin).length === 0 && <p className="muted">{tr('se.mineEmpty')}</p>}
          {templates
            .filter((t) => !t.builtin)
            .map((t) => (
              <TemplateRow key={t.id} runtime={runtime} t={t} active={t.id === sourceId} onClick={() => load(t)} />
            ))}
          <h3>{tr('se.builtin')}</h3>
          {templates
            .filter((t) => t.builtin)
            .map((t) => (
              <TemplateRow key={t.id} runtime={runtime} t={t} active={t.id === sourceId} onClick={() => load(t)} />
            ))}
        </aside>
        <main className="se-main">
          <div className="se-tools">
            <span>{tr('se.add')}</span>
            <button onClick={() => addElement('rect')}>{tr('se.el.rect')}</button>
            <button onClick={() => addElement('roundRect')}>{tr('se.el.roundRect')}</button>
            <button onClick={() => addElement('ellipse')}>{tr('se.el.ellipse')}</button>
            <button onClick={() => addElement('line')}>{tr('se.el.line')}</button>
            <button onClick={() => addElement('text')}>{tr('se.el.text')}</button>
            <span className="sep" />
            <button disabled={!selected} onClick={() => reorder(1)}>
              {tr('se.front')}
            </button>
            <button disabled={!selected} onClick={() => reorder(-1)}>
              {tr('se.back2')}
            </button>
            <button disabled={!selected} onClick={removeSelected}>
              {tr('common.delete')}
            </button>
          </div>
          <div className="se-stage">
            <StampCanvas
              runtime={runtime}
              template={draft}
              values={values}
              scale={SCALE}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={editElement}
            />
          </div>
          <div className="se-actual">
            <span className="muted">{tr('se.actualSize')}</span>
            <StampPreview runtime={runtime} template={draft} values={values} color={draft.color} scale={1} />
            {fields.length > 0 && (
              <span className="muted">
                {tr('se.fields', { fields: fields.map((f) => f.key).join(' / ') })}
              </span>
            )}
          </div>
        </main>
        <aside className="se-props">
          <h3>{tr('se.stamp')}</h3>
          <label>
            {tr('se.name')}
            <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
          </label>
          <div className="se-row">
            <label>
              {tr('se.width')}
              <input type="number" min={10} max={300} step={1} value={draft.width} onChange={(e) => edit({ width: +e.target.value })} />
            </label>
            <label>
              {tr('se.height')}
              <input type="number" min={10} max={300} step={1} value={draft.height} onChange={(e) => edit({ height: +e.target.value })} />
            </label>
            <span className="muted">pt</span>
          </div>
          <label>
            {tr('common.color')}
            <select value={draft.color} onChange={(e) => edit({ color: e.target.value })}>
              {STAMP_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr(`stamp.color.${c.id}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="se-actions">
            <button className="primary" onClick={save} disabled={!dirty && !isBuiltin}>
              {isBuiltin ? tr('se.saveAsMine') : tr('common.save')}
            </button>
            <button onClick={duplicate}>{tr('se.duplicate')}</button>
            <button onClick={remove} disabled={!source || isBuiltin} className="danger-text">
              {tr('common.delete')}
            </button>
          </div>

          {selected ? (
            <ElementProps element={selected} onChange={editElement} />
          ) : (
            <p className="muted">{tr('se.propsHint')}</p>
          )}

          {textElements.length > 0 && (
            <details className="se-help">
              <summary>{tr('se.syntax')}</summary>
              <ul>
                <li>
                  <code>{'{上段}'}</code> {tr('se.syntax.field')}
                </li>
                <li>
                  <code>{'{上段:承認}'}</code> {tr('se.syntax.default')}
                </li>
                <li>
                  <code>{'{日付}'}</code> <code>{'{短い日付}'}</code> {tr('se.syntax.date')}
                </li>
                <li>
                  <code>{'{氏名}'}</code> <code>{'{部署}'}</code> {tr('se.syntax.remembered')}
                </li>
              </ul>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

function TemplateRow({
  runtime,
  t,
  active,
  onClick,
}: {
  runtime: PdfRuntime;
  t: StampTemplate;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`se-item${active ? ' active' : ''}`} onClick={onClick} title={templateName(t)}>
      <span className="se-thumb">
        <StampPreview
          runtime={runtime}
          template={t}
          values={previewValues(t)}
          color={t.color}
          scale={Math.min(1, 46 / Math.max(t.width, t.height))}
        />
      </span>
      <span>{templateName(t)}</span>
    </button>
  );
}
