import type { PdfRuntime } from '../pdf/engine';
import { StampPreview } from '../annotations/stamps/StampPreview';
import { dateValues, templateFields, templateName, type StampTemplate } from '../annotations/stamps/template';
import { useT } from '../i18n';

/** Values filled into the preview: the default if any, otherwise the label itself (so the field is recognizable) */
export function previewValues(t: StampTemplate): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of templateFields(t)) v[f.key] = f.defaultValue || f.key;
  return { ...v, ...dateValues('wareki') };
}

interface Props {
  runtime: PdfRuntime;
  /** User stamps (not built-in) */
  mine: StampTemplate[];
  builtin: StampTemplate[];
  activeId: string | null;
  onPick: (t: StampTemplate) => void;
}

/** Left pane of the stamp editor: the user's stamps, then the built-in ones */
export function TemplateList({ runtime, mine, builtin, activeId, onPick }: Props) {
  const tr = useT();
  const row = (t: StampTemplate) => (
    <TemplateRow key={t.id} runtime={runtime} t={t} active={t.id === activeId} onClick={() => onPick(t)} />
  );
  return (
    <aside className="se-list">
      <h3>{tr('se.mine')}</h3>
      {mine.length === 0 && <p className="muted">{tr('se.mineEmpty')}</p>}
      {mine.map(row)}
      <h3>{tr('se.builtin')}</h3>
      {builtin.map(row)}
    </aside>
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
