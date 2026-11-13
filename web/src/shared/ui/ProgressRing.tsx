import styles from './ProgressRing.module.css';

const SIZES = {
  lg: { box: 168, r: 76, stroke: 6 },
  md: { box: 96, r: 43, stroke: 5 },
  pill: { box: 22, r: 9, stroke: 2.5 },
} as const;

interface ProgressRingProps {
  value: number;
  size?: keyof typeof SIZES;
  paused?: boolean;
  label: string;
  caption?: string;
}

/** Champagne stroke over --color-line; grey when paused (FRONTEND-SPEC "Anel de progresso"). */
export function ProgressRing({ value, size = 'lg', paused = false, label, caption }: ProgressRingProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const { box, r, stroke } = SIZES[size];
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  const c = box / 2;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={caption ? `${pct}%, ${caption}` : `${pct}%`}
      aria-label={label}
      className={[styles.ring, styles[size], paused ? styles.paused : null].filter(Boolean).join(' ')}
      style={{ width: box, height: box }}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {pct > 0 ? (
          <circle
            className={styles.arc}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={paused ? 'var(--color-text-muted)' : 'var(--color-accent)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash.toFixed(1)} ${circumference.toFixed(1)}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
      </svg>
      {size !== 'pill' ? (
        <div className={styles.center}>
          <span className={styles.value}>{pct}%</span>
          {caption ? <span className={styles.caption}>{caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
