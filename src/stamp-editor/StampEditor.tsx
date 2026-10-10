import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { PdfRuntime } from '../pdf/engine';
import { StampPreview } from '../annotations/stamps/StampPreview';
import { Icons } from '../annotations/icons';
import { templateFields } from '../annotations/stamps/template';
import {
  putTemplate,
  templatesFromJson,
  templatesToJson,
  useStampTemplates,
} from '../annotations/stamps/template-store';
import { JSON_TYPE, pickSaveTarget, writeSaveTarget } from '../pdf/download';
import { StampCanvas } from './StampCanvas';
import { TemplateList, previewValues } from './TemplateList';
import { StampPropsPane } from './StampPropsPane';
import { useStampDraft, type ElementKind } from './useStampDraft';
import { Brand } from '../app/Brand';
import { t as tr0, useT } from '../i18n';

const SCALE = 5;
const ADDABLE: ElementKind[] = ['rect', 'roundRect', 'ellipse', 'line', 'text'];

/** Stamp editor screen (#/stamps). Left: list, center: canvas, right: properties */
export function StampEditor({ runtime }: { runtime: PdfRuntime }) {
  const templates = useStampTemplates();
  const [status, setStatus] = useState('');
  const d = useStampDraft(templates, setStatus);
  const { draft, selected } = d;
  const fileInput = useRef<HTMLInputElement>(null);
  const tr = useT();

  const values = useMemo(() => previewValues(draft), [draft]);
  const mine = templates.filter((t) => !t.builtin);
  const builtin = templates.filter((t) => t.builtin);

  useEffect(() => {
    const prev = document.title;
    document.title = tr0('se.docTitle');
    return () => {
      document.title = prev;
    };
  }, []);

  const exportJson = async () => {
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

  const fields = templateFields(draft);

  return (
    <div className="stamp-editor">
      <header className="se-header">
        <Brand />
        <span className="sep" />
        <strong>{tr('se.title')}</strong>
        <button onClick={d.startNew}>{tr('se.new')}</button>
        <button onClick={() => fileInput.current?.click()}>{tr('se.import')}</button>
        <button onClick={exportJson}>{tr('se.export')}</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importJson} />
        <span className="se-status">{status}</span>
        <a href="#/" className="icon-btn se-back" title={tr('se.back')} aria-label={tr('se.back')}>
          <Icons.back />
        </a>
      </header>
      <div className="se-body">
        <TemplateList runtime={runtime} mine={mine} builtin={builtin} activeId={d.sourceId} onPick={d.load} />
        <main className="se-main">
          <div className="se-tools">
            <span>{tr('se.add')}</span>
            {ADDABLE.map((kind) => (
              <button key={kind} onClick={() => d.addElement(kind)}>
                {tr(`se.el.${kind}`)}
              </button>
            ))}
            <span className="sep" />
            <button disabled={!selected} onClick={() => d.reorder(1)}>
              {tr('se.front')}
            </button>
            <button disabled={!selected} onClick={() => d.reorder(-1)}>
              {tr('se.back2')}
            </button>
            <button disabled={!selected} onClick={d.removeSelected}>
              {tr('common.delete')}
            </button>
          </div>
          <div className="se-stage">
            <StampCanvas
              runtime={runtime}
              template={draft}
              values={values}
              scale={SCALE}
              selectedId={d.selectedId}
              onSelect={d.setSelectedId}
              onChange={d.editElement}
            />
          </div>
          <div className="se-actual">
            <span className="muted">{tr('se.actualSize')}</span>
            <StampPreview runtime={runtime} template={draft} values={values} color={draft.color} scale={1} />
            {fields.length > 0 && (
              <span className="muted">{tr('se.fields', { fields: fields.map((f) => f.key).join(' / ') })}</span>
            )}
          </div>
        </main>
        <StampPropsPane draft={d} />
      </div>
    </div>
  );
}
