// Line icons drawn inline (FRONTEND-SPEC: simple line, uniform 1.5px stroke).
import type { ReactNode } from 'react';

const LINE: Record<string, ReactNode> = {
  wifi: (
    <>
      <path d="M2 8.8A15 15 0 0122 8.8M5 12.5a10 10 0 0114 0M8.5 16.2a5 5 0 017 0" />
      <circle cx="12" cy="19.5" r="0.8" fill="currentColor" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M3 3l18 18M8.5 16.2a5 5 0 017 0M5 12.5a10 10 0 014.2-2.5M19 12.5a10 10 0 00-2.7-1.9M2 8.8a15 15 0 014.5-2.9M22 8.8A15 15 0 0011.5 5" />
      <circle cx="12" cy="19.5" r="0.8" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />,
  logout: <path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5l-5-5-9 9" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5M12 16v.1" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  share: <path d="M12 15V3.5M8 7.5l4-4 4 4M5 12.5v6a2 2 0 002 2h10a2 2 0 002-2v-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 8h16M4 16h16" />,
  phone: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5M10.5 18.5h3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4.5" />
      <path d="M11.5 11l8.5-8.5M17 5.5l2.5 2.5M14.5 8l2 2" />
    </>
  ),
  compare: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />,
};

export type IconName = keyof typeof LINE;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.5, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {LINE[name]}
    </svg>
  );
}

type StatusKind = 'done' | 'error' | 'warn';

/** Filled status disc: green check, coral x or coral exclamation. */
export function StatusIcon({ kind, size = 22, label }: { kind: StatusKind; size?: number; label?: string }) {
  const fill = kind === 'done' ? 'var(--color-success)' : 'var(--color-error)';
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" focusable="false" {...a11y}>
      <circle cx="12" cy="12" r="10" fill={fill} />
      {kind === 'done' && (
        <path
          d="M7.5 12.5l3 3 6-6.5"
          fill="none"
          stroke="var(--color-bg)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === 'error' && (
        <path d="M9 9l6 6M15 9l-6 6" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" />
      )}
      {kind === 'warn' && (
        <path d="M12 7.5v5.5M12 16.5v.1" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** Small champagne spinner (button loading, step loading). */
export function Spinner({
  size = 20,
  onAccent = false,
  label,
}: {
  size?: number;
  onAccent?: boolean;
  label?: string;
}) {
  const track = onAccent ? 'rgba(26,22,16,0.25)' : 'var(--color-line-strong)';
  const head = onAccent ? 'var(--color-on-accent)' : 'var(--color-accent)';
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      className="spinner"
      {...a11y}
    >
      <circle cx="12" cy="12" r="8.5" stroke={track} strokeWidth="2.5" />
      <path d="M12 3.5a8.5 8.5 0 018.5 8.5" stroke={head} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
