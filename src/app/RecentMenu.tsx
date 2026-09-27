import { useRef, useState } from 'react';
import { useDismiss } from '../shared/useDismiss';
import { removeRecent, useRecentList, type RecentMeta } from './recent-store';
import { useT } from '../i18n';

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);
export const formatSavedAt = (t: number) =>
  new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Small dropdown next to "Open". Lists recent files, newest first */
export function RecentMenu({ onOpen }: { onOpen: (meta: RecentMeta) => void }) {
  const [open, setOpen] = useState(false);
  const list = useRecentList();
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  return (
    <div ref={root} className="menu">
      <button
        className="icon-btn recent-btn"
        title={t('recent.title')}
        aria-label={t('recent.title')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu-list recent-list" onMouseLeave={() => setOpen(false)}>
          {list.length === 0 && <span className="menu-help">{t('recent.empty')}</span>}
          {list.map((m) => (
            <div key={m.id} className="recent-row">
              <button
                onClick={() => {
                  setOpen(false);
                  onOpen(m);
                }}
              >
                <span className="menu-label">{m.name}</span>
                <span className="menu-help">
                  {formatSavedAt(m.savedAt)} · {formatBytes(m.size)}
                  {m.contentEdited && t('recent.contentEdited')}
                </span>
              </button>
              <button className="recent-remove" title={t('recent.remove')} aria-label={t('recent.remove')} onClick={() => void removeRecent(m.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
