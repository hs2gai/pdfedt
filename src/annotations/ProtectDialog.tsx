import { useState, type FormEvent } from 'react';
import { useT } from '../i18n';

export type ProtectKind = 'full' | 'flatten';

interface Props {
  onSubmit: (kind: ProtectKind, password: string) => void;
  onCancel: () => void;
}

/**
 * "Save with password": asks for the new open password (twice), the save kind and
 * an explicit acknowledgement of the disclaimer. The password is passed on in memory only.
 */
export function ProtectDialog({ onSubmit, onCancel }: Props) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [kind, setKind] = useState<ProtectKind>('full');
  const [agreed, setAgreed] = useState(false);
  const mismatch = confirm !== '' && confirm !== password;
  const ready = password !== '' && password === confirm && agreed;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSubmit(kind, password);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal protect-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{t('protect.title')}</h2>
        <label>
          {t('protect.password')}
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <label>
          {t('protect.confirm')}
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {mismatch && <p className="error">{t('protect.mismatch')}</p>}
        <p className="muted">{t('protect.hint')}</p>
        <fieldset>
          <legend>{t('protect.kind')}</legend>
          {(['full', 'flatten'] as const).map((k) => (
            <label key={k} className="radio">
              <input type="radio" name="protect-kind" checked={kind === k} onChange={() => setKind(k)} />
              {t(`save.${k}`)}
            </label>
          ))}
        </fieldset>
        <ul className="warnings">
          <li className="danger">{t('protect.disclaimer.forget')}</li>
          <li className="warn">{t('protect.disclaimer.warranty')}</li>
        </ul>
        <label className="agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {t('protect.agree')}
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {t('protect.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
