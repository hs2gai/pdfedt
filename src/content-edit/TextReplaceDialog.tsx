import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fontLabel, type FontId } from '../pdf/fonts/catalog';
import { FontSelect } from '../annotations/FontSelect';
import { useT } from '../i18n';

interface Props {
  initialText: string;
  /** Original font name (for display) */
  originalFont?: string;
  /** Typeface guessed from the original font */
  suggestedFont: FontId;
  bold: boolean;
  /** Name of the matching PC font, if the same typeface as the original is installed ('local' becomes the default choice) */
  localFont?: string;
  anchor: { x: number; y: number };
  onCommit: (text: string, font: FontId | 'local') => void;
  onCancel: () => void;
}

/** Input for replacing content text. Enter confirms, Esc cancels */
export function TextReplaceDialog({ initialText, originalFont, suggestedFont, bold, localFont, anchor, onCommit, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const [font, setFont] = useState<FontId | 'local'>(localFont ? 'local' : suggestedFont);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter') onCommit(text, font);
  };
  const left = Math.min(anchor.x, window.innerWidth - 440);
  const top = Math.min(anchor.y, window.innerHeight - 200);
  return (
    <div className="popover content-replace" style={{ left, top }} onKeyDown={onKey}>
      {/* Unlike editing an annotation this rewrites the document's own text, so use the same red as the content editing banner */}
      <div className="content-replace-title">{t('content.replace.title')}</div>
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('content.replace.placeholder')} />
      <div className="popover-row">
        <label>
          {t('common.font')}
          <FontSelect value={font as FontId} onChange={(id) => setFont(id as FontId | 'local')}>
            {localFont && <option value="local">{t('content.replace.sameFont', { name: localFont })}</option>}
          </FontSelect>
        </label>
      </div>
      <div className="muted" title={originalFont}>
        {t('content.replace.originalFont', { name: originalFont?.replace(/^[A-Z]{6}\+/, '') || t('common.unknown') })}
        {bold && font !== 'local' && t('content.replace.fakeBold')}
        {font === suggestedFont || font === 'local' ? '' : t('content.replace.suggested', { label: fontLabel(suggestedFont) })}
      </div>
      <div className="popover-row">
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          {t('common.discard')}
        </button>
        <button type="button" className="primary" onClick={() => onCommit(text, font)} disabled={!text.trim()}>
          {t('content.replace.ok')}
        </button>
      </div>
    </div>
  );
}
