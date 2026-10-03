import { useEffect, useState, type FormEvent } from 'react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useAppSettings } from '../app/settings';
import { useT } from '../i18n';
import { parsePageNumber } from './page-number';

/** "3 / 12" in the toolbar. Type a page number and press Enter to go there */
export function PageNavigator({ documentId }: { documentId: string }) {
  const { provides: scroll, state } = useScroll(documentId);
  const { smoothScroll } = useAppSettings();
  const t = useT();
  const [text, setText] = useState(String(state.currentPage));
  const [editing, setEditing] = useState(false);

  // Follow the scroll position unless the user is typing
  useEffect(() => {
    if (!editing) setText(String(state.currentPage));
  }, [state.currentPage, editing]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const page = parsePageNumber(text, state.totalPages);
    if (page !== null) scroll?.scrollToPage({ pageNumber: page, behavior: smoothScroll ? 'smooth' : 'instant' });
    setText(String(page ?? state.currentPage));
    (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur();
  };

  return (
    <form className="page-nav" onSubmit={submit} title={t('toolbar.page.help')}>
      <input
        aria-label={t('toolbar.page')}
        inputMode="numeric"
        value={text}
        style={{ width: `${Math.max(2, String(state.totalPages).length)}ch` }}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText(String(state.currentPage));
            e.currentTarget.blur();
          }
        }}
      />
      <span className="page-total">/ {state.totalPages}</span>
    </form>
  );
}
