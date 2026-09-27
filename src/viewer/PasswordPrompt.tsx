import { useState, type FormEvent } from 'react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useT } from '../i18n';
import { rememberPassword } from '../pdf/export';

interface Props {
  documentId: string;
  /** Whether a password was already sent once and failed */
  retried: boolean;
}

/** Input for opening a password-protected PDF. The password is used in memory only and never stored */
export function PasswordPrompt({ documentId, retried }: Props) {
  const { provides: docs } = useDocumentManagerCapability();
  const [password, setPassword] = useState('');
  const t = useT();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!docs || !password) return;
    rememberPassword(documentId, password);
    docs.retryDocument(documentId, { password });
    setPassword('');
  };

  return (
    <form className="password-prompt" onSubmit={submit}>
      <p>{t('password.protected')}</p>
      {retried && <p className="error">{t('password.wrong')}</p>}
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('password.placeholder')}
        aria-label={t('password.label')}
      />
      <button type="submit" className="primary" disabled={!password}>
        {t('password.open')}
      </button>
      <p className="muted">{t('password.note')}</p>
    </form>
  );
}
