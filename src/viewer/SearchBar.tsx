import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@embedpdf/plugin-search/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { MatchFlag } from '@embedpdf/models';
import { REGEX_FLAG, regexError } from '../pdf/regex-search';
import { Icons } from '../annotations/icons';
import { useT } from '../i18n';

/** Wait after typing before searching (searching every keystroke on a long document is wasted work) */
const SEARCH_DELAY_MS = 250;

interface Props {
  documentId: string;
  /** Changes on every Ctrl+F so an already open bar takes the focus again */
  focusKey: number;
  onClose: () => void;
}

/**
 * Text search bar (Ctrl+F). Searches as you type, highlights every hit (SearchLayer on each page)
 * and scrolls to the current one. Enter / Shift+Enter go to the next / previous hit, Esc closes.
 * Toggles: match case (Aa) and regular expression (.*). They live in the plugin's flags, so they survive closing the bar
 */
export function SearchBar({ documentId, focusKey, onClose }: Props) {
  const { provides: search, state } = useSearch(documentId);
  const { provides: scroll } = useScroll(documentId);
  const t = useT();
  const [text, setText] = useState(state.query);
  // useSearch's state is the default one on the first render, so read the flags from the plugin directly
  const [matchCase, setMatchCase] = useState(() => !!search?.getFlags().includes(MatchFlag.MatchCase));
  const [regex, setRegex] = useState(() => !!search?.getFlags().includes(REGEX_FLAG));
  const input = useRef<HTMLInputElement>(null);
  const invalid = regex && text.trim() ? regexError(text.trim()) : null;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  // Toggles apply at once (setFlags re-runs the current query); typing is debounced
  useEffect(() => {
    const flags = [...(matchCase ? [MatchFlag.MatchCase] : []), ...(regex ? [REGEX_FLAG] : [])];
    if (search && flags.join() !== search.getFlags().join()) search.setFlags(flags);
  }, [matchCase, regex, search]);

  useEffect(() => {
    if (!search) return;
    // An invalid pattern (often half-typed) clears the hits instead of searching
    const timer = window.setTimeout(() => search.searchAllPages(invalid ? '' : text), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, invalid, search]);

  // Bring the current hit into view (slightly above the middle, like browsers do)
  useEffect(
    () =>
      search?.onActiveResultChange((index) => {
        const hit = search.getState().results[index];
        const rect = hit?.rects[0];
        if (!hit || !rect) return;
        scroll?.scrollToPage({
          pageNumber: hit.pageIndex + 1,
          pageCoordinates: { x: rect.origin.x, y: rect.origin.y },
          alignX: 50,
          alignY: 40,
          behavior: 'instant',
        });
      }),
    [search, scroll],
  );

  // Closing the bar removes the highlights
  useEffect(() => () => search?.stopSearch(), [search]);

  const status = !text.trim()
    ? ''
    : invalid
      ? t('search.invalidRegex')
      : state.loading && state.total === 0
      ? t('search.searching')
      : state.total === 0
        ? t('search.none')
          : t('search.count', { current: state.activeResultIndex + 1, total: state.total });

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, help: string, glyph: string) => (
    <button
      type="button"
      className={`icon-btn search-toggle${on ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={on}
      title={help}
      onClick={() => {
        set(!on);
        input.current?.focus();
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div className="search-bar" role="search">
      <Icons.search className="search-icon" />
      <input
        ref={input}
        type="search"
        aria-label={t('search.label')}
        aria-invalid={invalid ? true : undefined}
        placeholder={t('search.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.shiftKey) search?.previousResult();
            else search?.nextResult();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      {toggle(matchCase, setMatchCase, t('search.matchCase'), t('search.matchCase.help'), 'Aa')}
      {toggle(regex, setRegex, t('search.regex'), t('search.regex.help'), '.*')}
      <span className={`search-status${invalid ? ' error' : ''}`} aria-live="polite" title={invalid ?? undefined}>
        {status}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('search.prev')}
        title={t('search.prev.help')}
        disabled={state.total === 0}
        onClick={() => search?.previousResult()}
      >
        <Icons.chevronUp />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('search.next')}
        title={t('search.next.help')}
        disabled={state.total === 0}
        onClick={() => search?.nextResult()}
      >
        <Icons.chevronDown />
      </button>
      <button type="button" className="icon-btn" aria-label={t('common.close')} title="Esc" onClick={onClose}>
        <Icons.close />
      </button>
    </div>
  );
}
