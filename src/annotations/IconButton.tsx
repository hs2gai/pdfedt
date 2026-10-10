import { Icons, type IconName } from './icons';

/** Icon button. The label is kept for screen readers (tests also look for this string) */
export function IconButton({
  icon,
  label,
  title,
  active,
  ...rest
}: {
  icon: IconName;
  label: string;
  title?: string;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const Icon = Icons[icon];
  return (
    <button
      {...rest}
      className={`icon-btn${active ? ' active' : ''}${rest.className ? ' ' + rest.className : ''}`}
      title={title ? `${label} — ${title}` : label}
      aria-label={label}
    >
      <Icon />
      <span className="sr-only">{label}</span>
    </button>
  );
}
