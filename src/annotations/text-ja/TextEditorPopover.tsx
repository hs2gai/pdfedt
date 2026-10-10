import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TextStyle } from './text-annotation';
import { DEFAULT_FONT_ID, type FontId } from '../../pdf/fonts/catalog';
import { FontSelect } from '../FontSelect';
import { ColorSelect } from '../StyleControls';
import { INK_COLORS, hexToRgb, rgbToHex } from '../annot-style';
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

/** Text input popover. Ctrl+Enter confirms, Esc cancels */
export function TextEditorPopover({ request, style, onCommit, onCancel }: Props) {
  const [text, setText] = useState(request.initialText);
  const t = useT();
  const [fontSize, setFontSize] = useState(style.fontSize);
  const [color, setColor] = useState(style.color);
  const [font, setFont] = useState<FontId>(style.font ?? DEFAULT_FONT_ID);
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
        <ColorSelect value={rgbToHex(color)} palette={INK_COLORS} onChange={(hex) => setColor(hexToRgb(hex))} />
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
