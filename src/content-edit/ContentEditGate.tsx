import { isLockedBySignature, type DocumentInfo } from '../pdf/inspector';
import { useT } from '../i18n';

interface Props {
  info: DocumentInfo | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation before entering content editing mode. Warns according to the document inspection.
 * Documents whose signature forbids changes (DocMDP 1–2) cannot enter.
 */
export function ContentEditGate({ info, onConfirm, onCancel }: Props) {
  const blocked = isLockedBySignature(info);
  const t = useT();
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{t('content.gate.title')}</h2>
        <ul className="warnings">
          <li className="warn">{t('content.gate.irreversible')}</li>
          {info && info.signatures > 0 && (
            <li className={blocked ? 'danger' : 'warn'}>
              {t('content.gate.signature')}
              {blocked && t('content.gate.signatureBlocked')}
            </li>
          )}
          {info?.tagged && (
            <li className="warn">{t('content.gate.tagged')}</li>
          )}
          {info?.formType === 'xfa' && <li className="danger">{t('content.gate.xfa')}</li>}
          <li>{t('content.gate.saveAs')}</li>
          <li>{t('content.gate.fontReplaced')}</li>
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={onConfirm} disabled={blocked}>
            {t('content.gate.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
