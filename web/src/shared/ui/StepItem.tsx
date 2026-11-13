import type { StepState } from '../api/schemas';
import { t } from '../i18n/pt-AO';
import { Spinner, StatusIcon } from './Icon';
import styles from './StepItem.module.css';

function StateIcon({ state }: { state: StepState }) {
  const label = t.processing.stepState[state];
  if (state === 'completed') return <StatusIcon kind="done" label={label} />;
  if (state === 'error') return <StatusIcon kind="error" label={label} />;
  if (state === 'loading') return <Spinner size={22} label={label} />;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" role="img" aria-label={label}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" />
    </svg>
  );
}

export function StepItem({ state, label, count }: { state: StepState; label: string; count: string }) {
  return (
    <li className={`${styles.item} ${styles[state]}`}>
      <span className={styles.icon}>
        <StateIcon state={state} />
      </span>
      <span className={styles.label}>{label}</span>
      <span className={styles.count}>{count}</span>
    </li>
  );
}
