import type { DocumentInfo } from '../pdf/inspector';
import { useT } from '../i18n';

/**
 * Shows the document's properties (signatures, forms, tags, encryption) as short badges.
 * Helps the user decide the save kind and whether content editing is possible.
 */
export function DocumentBadges({ info }: { info: DocumentInfo | null }) {
  const t = useT();
  if (!info) return null;
  const badges = describe(info, t);
  if (badges.length === 0) return null;
  return (
    <div className="badges">
      {badges.map((b) => (
        <span key={b.label} className={`badge badge-${b.level}`} title={b.title}>
          {b.label}
        </span>
      ))}
    </div>
  );
}

interface Badge {
  label: string;
  title: string;
  level: 'info' | 'warn' | 'danger';
}

function describe(info: DocumentInfo, t: ReturnType<typeof useT>): Badge[] {
  const out: Badge[] = [];
  if (info.signatures > 0) {
    const level = info.docMdp === 3 || info.docMdp === 0 ? 'info' : 'warn';
    const detail =
      info.docMdp === 1
        ? t('badge.signature.locked')
        : info.docMdp === 2
          ? t('badge.signature.formOnly')
          : t('badge.signature.ok');
    out.push({ label: t('badge.signature', { count: info.signatures }), title: detail, level });
  }
  if (info.formType !== 'none' && (info.formType === 'xfa' || info.formFields > 0)) {
    out.push({
      label: info.formType === 'xfa' ? t('badge.xfa') : t('badge.form', { count: info.formFields }),
      title: info.formType === 'xfa' ? t('badge.xfa.help') : t('badge.form.help'),
      level: info.formType === 'xfa' ? 'warn' : 'info',
    });
  }
  if (info.tagged) {
    out.push({
      label: t('badge.tagged'),
      title: t('badge.tagged.help'),
      level: 'info',
    });
  }
  if (info.encrypted) {
    out.push({
      label: info.canAnnotate ? t('badge.encrypted') : t('badge.noAnnotate'),
      title: info.canAnnotate
        ? t('badge.encrypted.help')
        : info.canFillForms
          ? t('badge.noAnnotate.formOk')
          : t('badge.noAnnotate.help'),
      level: info.canAnnotate ? 'info' : 'danger',
    });
  }
  return out;
}
