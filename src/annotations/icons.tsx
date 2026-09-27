import type { SVGProps } from 'react';

/** Line icons for the toolbar (24×24, currentColor) */
type IconProps = SVGProps<SVGSVGElement>;

const base = (children: React.ReactNode, filled = false) =>
  function Icon(props: IconProps) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };

export const Icons = {
  settings: base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
  ),
  open: base(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>,
  ),
  pages: base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>,
  ),
  zoomOut: base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6" />
    </>,
  ),
  zoomIn: base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6M11 8v6" />
    </>,
  ),
  select: base(<path d="M5 3l14 8-6 1.5L16 19l-3 1.5-3-6.5L5 17z" />),
  text: base(
    <>
      <path d="M5 6h14M12 6v13M9 19h6" />
    </>,
  ),
  // Hanko stamp (handle + face)
  // Callout text (box + arrow)
  callout: base(
    <>
      <rect x="9" y="4" width="12" height="8" rx="1" />
      <path d="M9 8H6l-2 11" />
      <path d="m2 15 2 4 3-3" />
    </>,
  ),
  stamp: base(
    <>
      <path d="M9 9V5.5a3 3 0 0 1 6 0V9" />
      <path d="M6 9h12a1 1 0 0 1 1 1v3H5v-3a1 1 0 0 1 1-1z" />
      <path d="M4 17h16v3H4z" />
    </>,
  ),
  // Hanko with + (opens the stamp editor)
  stampNew: base(
    <>
      <path d="M9 9V5.5a3 3 0 0 1 6 0V9" />
      <path d="M6 9h12a1 1 0 0 1 1 1v3H5v-3a1 1 0 0 1 1-1z" />
      <path d="M4 17h9" />
      <path d="M17 14.5v6M14 17.5h6" />
    </>,
  ),
  // Back to the editor (left arrow + document)
  back: base(
    <>
      <path d="M13 5h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-4" />
      <path d="M11 12H3m0 0 3-3m-3 3 3 3" />
    </>,
  ),
  image: base(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m21 16-5-5-8 8" />
    </>,
  ),
  content: base(
    <>
      <path d="M4 6h12M4 10h12M4 14h8" />
      <path d="m14 13 6 3-2.5 1-1.5 3z" />
    </>,
  ),
  note: base(
    <>
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1z" />
      <path d="M8 8h8M8 11h5" />
    </>,
  ),
  highlight: base(
    <>
      <path d="M4 20h16" />
      <path d="m6 16 8-8 3 3-8 8H6z" />
      <path d="m14 8 2-2 3 3-2 2" />
    </>,
  ),
  underline: base(
    <>
      <path d="M7 4v7a5 5 0 0 0 10 0V4" />
      <path d="M5 20h14" />
    </>,
  ),
  strikeout: base(
    <>
      <path d="M8 6.5A4 4 0 0 1 12 5c3 0 4 1.5 4 3M16 16.5c-.5 2-2 3-4 3-3 0-4.5-1.5-4.5-3.5" />
      <path d="M4 12h16" />
    </>,
  ),
  ink: base(
    <>
      <path d="M4 20c2-6 5-9 8-9s3 5 6 5 2-4 2-4" />
    </>,
  ),
  square: base(<rect x="4" y="5" width="16" height="14" rx="1" />),
  close: base(<path d="M6 6l12 12M18 6L6 18" />),
  circle: base(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />),
  line: base(<path d="M5 19 19 5" />),
  arrow: base(
    <>
      <path d="M5 19 19 5" />
      <path d="M11 5h8v8" />
    </>,
  ),
  trash: base(
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </>,
  ),
  undo: base(
    <>
      <path d="M8 7H4v4" />
      <path d="M4 11a8 8 0 1 1 2.3 7" />
    </>,
  ),
  redo: base(
    <>
      <path d="M16 7h4v4" />
      <path d="M20 11a8 8 0 1 0-2.3 7" />
    </>,
  ),
  edit: base(
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m13.5 6.5 3 3" />
    </>,
  ),
  save: base(
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </>,
  ),
};

export type IconName = keyof typeof Icons;
