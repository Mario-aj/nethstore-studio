import type { ReactNode } from 'react';
import { t } from '../i18n/pt-AO';
import styles from './AppHeader.module.css';

/** "NETHSTORE" on the left, an action or a label on the right. */
export function AppHeader({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  return (
    <header className={`${styles.header} ${compact ? styles.compact : ''}`}>
      <span className={styles.brand}>{t.brand}</span>
      {children}
    </header>
  );
}

export function HeaderLabel({ children }: { children: ReactNode }) {
  return <span className={styles.eyebrow}>{children}</span>;
}
