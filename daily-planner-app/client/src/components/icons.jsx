// Small inline SVG icons. Decorative: every button using one has its own
// accessible text, so the SVGs are hidden from screen readers.
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const PlusIcon = (p) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);

export const PencilIcon = (p) => (
  <svg {...base} {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
);

export const TrashIcon = (p) => (
  <svg {...base} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
);

export const ChevronIcon = (p) => (
  <svg {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
);

export const CloseIcon = (p) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const CheckIcon = (p) => (
  <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export const CheckCircleIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9.5" /></svg>
);

export const AlertIcon = (p) => (
  <svg {...base} {...p}><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></svg>
);

export const ClockIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export const LockIcon = (p) => (
  <svg {...base} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

export const FlagIcon = (p) => (
  <svg {...base} {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);

export const BoltIcon = (p) => (
  <svg {...base} {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
);

export const GearIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const InfoIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></svg>
);

export const CalendarIcon = (p) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);

export const SunIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const PersonIcon = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
