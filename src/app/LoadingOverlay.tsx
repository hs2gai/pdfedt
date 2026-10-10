import { useEffect, useState } from 'react';
import type { OpeningState, OpenPhase } from './useDocumentOpener';
import { formatBytes } from './RecentMenu';
import { useT } from '../i18n';

const PHASES: OpenPhase[] = ['reading', 'fonts', 'opening', 'rendering', 'preparing'];
/** After this long, add a note that large files take a while (and still stay on this PC) */
const SLOW_NOTE_MS = 3000;

/**
 * Covers the viewer while a document opens: which file, which step of how many, and a spinner.
 * PDFium blocks the main thread during the heavy steps; the spinner is a CSS transform animation, which the
 * browser keeps running off the main thread, so the screen visibly stays alive. Also keeps input out until ready
 */
export function LoadingOverlay({ opening }: { opening: OpeningState }) {
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_NOTE_MS);
    return () => clearTimeout(timer);
  }, []);
  const step = PHASES.indexOf(opening.phase) + 1;
  return (
    // From "rendering" on the page is (being) drawn, so the backdrop lightens to let it show through
    <div className={`loading-overlay${step >= 4 ? ' settled' : ''}`} role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-spinner" aria-hidden="true" />
        <div className="loading-name" title={opening.name}>
          {opening.name}
        </div>
        <div className="loading-size">{formatBytes(opening.size)}</div>
        <div className="loading-phase">
          {t(`loading.${opening.phase}`)}
          <span className="loading-step">
            {step} / {PHASES.length}
          </span>
        </div>
        <div className="loading-steps" aria-hidden="true">
          {PHASES.map((p, i) => (
            <span key={p} className={i < step - 1 ? 'done' : i === step - 1 ? 'current' : ''} />
          ))}
        </div>
        {slow && <p className="loading-note">{t('loading.slow')}</p>}
      </div>
    </div>
  );
}
