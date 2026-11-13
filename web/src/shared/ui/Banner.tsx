import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Banner.module.css';

interface BannerProps {
  tone: 'error' | 'success';
  icon: IconName;
  title: string;
  children?: ReactNode;
  trailing?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

/** Connection, lock and failure notices (FRONTEND-SPEC "Aviso de ligação"). */
export function Banner({ tone, icon, title, children, trailing, role = 'alert', className }: BannerProps) {
  return (
    <div role={role} className={[styles.banner, styles[tone], className].filter(Boolean).join(' ')}>
      <span className={styles.icon}>
        <Icon name={icon} size={22} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>{title}</strong>
        {children ? <span className={styles.body}>{children}</span> : null}
      </div>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </div>
  );
}

/** Pill-shaped one-line message under the processing title. */
export function Notice({ tone, children }: { tone: 'calm' | 'warn'; children: ReactNode }) {
  return (
    <p className={`${styles.notice} ${styles[tone]}`}>
      <Icon name="info" size={16} strokeWidth={1.6} />
      {children}
    </p>
  );
}
