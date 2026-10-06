import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TextStyle } from './text-annotation';
import type { FontId } from '../../pdf/fonts/catalog';
import { FontSelect } from '../FontSelect';
import { useT } from '../../i18n';

export interface TextEditorRequest {
  pageIndex: number;
  /** Top-left of the annotation (pt, top-left origin) */
  origin: { x: number; y: number };
  /** Screen position where the popover is shown */
  anchor: { x: number; y: number };
  initialText: string;
  /** Arrow tip for callouts (pt, top-left origin) */
  tip?: { x: number; y: number };
}

interface Props {
  request: TextEditorRequest;
  style: TextStyle;
  onCommit: (text: string, style: TextStyle) => void;
  onCancel: () => void;
}

const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 24];
const COLORS: { id: 'black' | 'red' | 'blue'; value: TextStyle['color'] }[] = [
  { id: 'black', value: { r: 0, g: 0, b: 0 } },
  { id: 'red', value: { r: 200, g: 0, b: 0 } },
  { id: 'blue', value: { r: 0, g: 60, b: 200 } },
];

/** Text input popover. Ctrl+Enter confirms, Esc cancels */
export function TextEditorPopover({ request, style, onCommit, onCancel }: Props) {
  const [text, setText] = useState(request.initialText);
  const t = useT();
  const [fontSize, setFontSize] = useState(style.fontSize);
  const [color, setColor] = useState(style.color);
  const [font, setFont] = useState<FontId>(style.font ?? 'gothic');
  const [vertical, setVertical] = useState(!!style.vertical);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onCommit(text, { fontSize, color, font, vertical });
  };

  // Clamp the position so it does not overflow the right / bottom edge of the screen
  const left = Math.min(request.anchor.x, window.innerWidth - 340);
  const top = Math.min(request.anchor.y, window.innerHeight - 200);

  return (
    <div className="popover" style={{ left, top }} onKeyDown={onKey}>
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('text.placeholder')}
      />
      <div className="popover-row">
        <label>
          {t('common.font')}
          <FontSelect value={font} onChange={setFont} />
        </label>
        <label>
          <input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} />
          {t('text.vertical')}
        </label>
      </div>
      <div className="popover-row">
        <label>
          {t('common.size')}
          <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="swatches">
          {COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={t(`text.color.${c.id}`)}
              className={
                c.value.r === color.r && c.value.g === color.g && c.value.b === color.b ? 'swatch active' : 'swatch'
              }
              style={{ background: `rgb(${c.value.r},${c.value.g},${c.value.b})` }}
              onClick={() => setColor(c.value)}
            />
          ))}
        </span>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          {t('common.discard')}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onCommit(text, { fontSize, color, font, vertical })}
          disabled={!text.trim()}
        >
          {t('common.ok')}
        </button>
      </div>
    </div>
  );
}
