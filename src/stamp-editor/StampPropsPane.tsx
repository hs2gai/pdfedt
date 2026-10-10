import { STAMP_COLORS } from '../annotations/stamps/template';
import { ElementProps } from './ElementProps';
import type { useStampDraft } from './useStampDraft';
import { useT } from '../i18n';

/** Right pane of the stamp editor: the stamp's own settings and actions, then the selected element */
export function StampPropsPane({ draft: d }: { draft: ReturnType<typeof useStampDraft> }) {
  const tr = useT();
  const { draft, edit } = d;
  return (
    <aside className="se-props">
      <h3>{tr('se.stamp')}</h3>
      <label>
        {tr('se.name')}
        <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
      </label>
      <div className="se-row">
        <label>
          {tr('se.width')}
          <input
            type="number"
            min={10}
            max={300}
            step={1}
            value={draft.width}
            onChange={(e) => edit({ width: +e.target.value })}
          />
        </label>
        <label>
          {tr('se.height')}
          <input
            type="number"
            min={10}
            max={300}
            step={1}
            value={draft.height}
            onChange={(e) => edit({ height: +e.target.value })}
          />
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
        <button className="primary" onClick={d.save} disabled={!d.dirty && !d.isBuiltin}>
          {d.isBuiltin ? tr('se.saveAsMine') : tr('common.save')}
        </button>
        <button onClick={d.duplicate}>{tr('se.duplicate')}</button>
        <button onClick={d.remove} disabled={!d.source || d.isBuiltin} className="danger-text">
          {tr('common.delete')}
        </button>
      </div>

      {d.selected ? (
        <ElementProps element={d.selected} onChange={d.editElement} />
      ) : (
        <p className="muted">{tr('se.propsHint')}</p>
      )}

      {draft.elements.some((e) => e.type === 'text') && (
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
  );
}
