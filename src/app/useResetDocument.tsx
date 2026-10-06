import { useState } from 'react';
import { openPasswordOf } from '../pdf/export';
import { getRecentOriginal, putRecent, type RecentMeta } from './recent-store';
import { useT } from '../i18n';

interface Options {
  documentId: string | null;
  /** "Recent files" entry of the open document */
  entry: RecentMeta | null;
  /** Reopen the document (EditorShell's openBytes). `password` keeps an encrypted document open without asking again */
  reopen: (bytes: Uint8Array, entry: RecentMeta, password?: string) => Promise<void>;
  onStatus: (msg: string) => void;
}

/**
 * "Revert to the original": throws away every change (annotations, form input, content edits, page operations)
 * and reopens the file as it was first opened, after a confirmation.
 * The working copy in "recent files" is replaced as well, so a reload does not bring the changes back
 */
export function useResetDocument({ documentId, entry, reopen, onStatus }: Options) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  const reset = async () => {
    setConfirming(false);
    if (!documentId || !entry) return;
    const original = await getRecentOriginal(entry.id);
    if (!original) {
      onStatus(t('reset.missing'));
      return;
    }
    // Read before reopening: reopen forgets the closed document's password
    const password = openPasswordOf(documentId) || undefined;
    const reverted: RecentMeta = { ...entry, size: original.byteLength, savedAt: Date.now(), contentEdited: false };
    await reopen(original, reverted, password);
    await putRecent(reverted, original);
    onStatus(t('reset.done'));
  };

  const dialog = confirming && (
    <div className="modal-backdrop" onClick={() => setConfirming(false)}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('reset.title')}</h2>
        <ul className="warnings">
          <li className="warn">{t('reset.lost')}</li>
          <li>{t('reset.saveFirst')}</li>
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={() => void reset()}>
            {t('reset.ok')}
          </button>
        </div>
      </div>
    </div>
  );

  return { request: () => setConfirming(true), dialog };
}
