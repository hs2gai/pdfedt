import { useT } from '../i18n';
/**
 * App name. Toolbar left end (small; click returns to the editor root) and the screen before a document is opened (large).
 * The mark shares its design with the PWA icon
 */
export function Brand({ size = 'small' }: { size?: 'small' | 'large' }) {
  const t = useT();
  const px = size === 'large' ? 40 : 20;
  const inner = (
    <>
      <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="var(--accent)" />
        <path d="M7 4h7l4 4v12H7z" fill="#fff" />
        <path d="M14 4v4h4" fill="#cfe0fb" />
        <rect x="9" y="11" width="6" height="1.6" fill="var(--accent)" />
        <rect x="9" y="14" width="3.5" height="1.6" fill="#f4b400" />
        <rect x="9" y="17" width="6" height="1.6" fill="var(--accent)" />
      </svg>
      <span className="brand-name">pdfugu</span>
    </>
  );
  return size === 'small' ? (
    <a className="brand brand-small" href="#/" title={t('brand.backToEditor', { version: __APP_VERSION__ })}>
      {inner}
    </a>
  ) : (
    <span className="brand brand-large" aria-label="pdfugu">
      {inner}
    </span>
  );
}
