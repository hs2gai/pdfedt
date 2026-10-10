import { useRef, useState } from 'react';
import { STROKE_WIDTHS, findColor, type PaletteColor } from './annot-style';
import { useDismiss } from '../shared/useDismiss';
import { useT, type MessageKey } from '../i18n';

const colorLabel = (c: PaletteColor) => `color.${c.id}` as MessageKey;

/** Swatch button that opens a grid of palette colors */
export function ColorSelect({
  value,
  palette,
  onChange,
  disabled,
}: {
  value: string;
  palette: PaletteColor[];
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(root, open, () => setOpen(false));
  const current = findColor(palette, value);
  const label = current ? t(colorLabel(current)) : value;
  return (
    <span
      ref={root}
      className="menu color-select"
      // Esc closes only the grid, not the surrounding popover. stopPropagation also stops the native event, so useDismiss never sees it
      onKeyDown={(e) => {
        if (!open || e.key !== 'Escape') return;
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="color-select-btn"
        title={`${t('common.color')}: ${label}`}
        aria-label={t('common.color')}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="swatch" style={{ background: value }} />
        <span className="caret">▾</span>
      </button>
      {open && (
        <span className="color-grid" role="listbox" aria-label={t('common.color')}>
          {palette.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c === current}
              title={t(colorLabel(c))}
              aria-label={t(colorLabel(c))}
              className={c === current ? 'swatch active' : 'swatch'}
              style={{ background: c.hex }}
              onClick={() => {
                setOpen(false);
                onChange(c.hex);
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** Stroke width (pt). A width outside the list (e.g. from another app) is shown as an extra option */
export function WidthSelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (width: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const widths = STROKE_WIDTHS.includes(value) ? STROKE_WIDTHS : [...STROKE_WIDTHS, value].sort((a, b) => a - b);
  return (
    <select
      className="width-select"
      value={value}
      title={t('common.strokeWidth')}
      aria-label={t('common.strokeWidth')}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {widths.map((w) => (
        <option key={w} value={w}>
          {w}pt
        </option>
      ))}
    </select>
  );
}
