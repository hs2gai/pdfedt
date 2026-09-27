import { STAMP_COLORS, type StampElement } from '../annotations/stamps/template';
import { FontSelect } from '../annotations/FontSelect';
import { useT } from '../i18n';

/** Values and settings of the selected element */
export function ElementProps({ element: el, onChange }: { element: StampElement; onChange: (el: StampElement) => void }) {
  const t = useT();
  const num = (key: string, label: string, step = 0.5, min?: number) => (
    <label key={key}>
      {label}
      <input
        type="number"
        step={step}
        min={min}
        value={(el as unknown as Record<string, number>)[key]}
        onChange={(e) => onChange({ ...el, [key]: +e.target.value } as StampElement)}
      />
    </label>
  );
  return (
    <div className="se-element">
      <h3>{t(`se.el.${el.type}`)}</h3>
      {el.type === 'line' ? (
        <>
          <div className="se-row">
            {num('x1', t('se.prop.x1'))}
            {num('y1', t('se.prop.y1'))}
          </div>
          <div className="se-row">
            {num('x2', t('se.prop.x2'))}
            {num('y2', t('se.prop.y2'))}
          </div>
        </>
      ) : (
        <>
          <div className="se-row">
            {num('x', 'X')}
            {num('y', 'Y')}
          </div>
          <div className="se-row">
            {num('w', t('se.prop.w'), 0.5, 2)}
            {num('h', t('se.prop.h'), 0.5, 2)}
          </div>
        </>
      )}
      {el.type === 'text' ? (
        <>
          <label>
            {t('se.prop.text')}
            <input value={el.text} onChange={(e) => onChange({ ...el, text: e.target.value })} />
          </label>
          <label>
            {t('common.font')}
            <FontSelect value={el.font ?? 'gothic'} onChange={(id) => onChange({ ...el, font: id === 'gothic' ? undefined : id })} />
          </label>
          <div className="se-row">
            {num('fontSize', t('se.prop.fontSize'), 0.5, 4)}
            <label>
              {t('se.prop.align')}
              <select value={el.align} onChange={(e) => onChange({ ...el, align: e.target.value as typeof el.align })}>
                <option value="left">{t('se.prop.align.left')}</option>
                <option value="center">{t('se.prop.align.center')}</option>
                <option value="right">{t('se.prop.align.right')}</option>
              </select>
            </label>
          </div>
          <label className="se-check">
            <input type="checkbox" checked={el.vertical} onChange={(e) => onChange({ ...el, vertical: e.target.checked })} />
            {t('se.prop.vertical')}
          </label>
          <label className="se-check" title={t('se.prop.collapse.help')}>
            <input
              type="checkbox"
              checked={!!el.collapseIfEmpty}
              onChange={(e) => onChange({ ...el, collapseIfEmpty: e.target.checked || undefined })}
            />
            {t('se.prop.collapse')}
          </label>
        </>
      ) : (
        <div className="se-row">
          {num('strokeWidth', t('se.prop.strokeWidth'), 0.1, 0.1)}
          {el.type === 'rect' && num('radius', t('se.prop.radius'), 0.5, 0)}
          {el.type !== 'line' && (
            <label className="se-check">
              <input type="checkbox" checked={el.fill} onChange={(e) => onChange({ ...el, fill: e.target.checked })} />
              {t('se.prop.fill')}
            </label>
          )}
        </div>
      )}
      <label>
        {t('common.color')}
        <select value={el.color ?? ''} onChange={(e) => onChange({ ...el, color: e.target.value || undefined })}>
          <option value="">{t('se.prop.stampColor')}</option>
          {STAMP_COLORS.map((c) => (
            <option key={c.id} value={c.id}>
              {t(`stamp.color.${c.id}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
