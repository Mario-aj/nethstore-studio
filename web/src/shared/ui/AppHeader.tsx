import type { ReactNode } from 'react';
import { t } from '../i18n/pt-AO';
import { Button } from './Button';
import { Icon } from './Icon';
import styles from './AppHeader.module.css';

interface AppHeaderProps {
  children?: ReactNode;
  compact?: boolean;
  /** Back arrow before the brand. The iPhone app has no back button of its own. */
  back?: { label: string; onClick: () => void };
}

/** "NETHSTORE" on the left, an action or a label on the right. */
export function AppHeader({ children, compact = false, back }: AppHeaderProps) {
  const classes = [styles.header, compact ? styles.compact : null, back ? styles.withBack : null]
    .filter(Boolean)
    .join(' ');
  return (
    <header className={classes}>
      <span className={styles.lead}>
        {back ? (
          <Button variant="iconOnly" aria-label={back.label} onClick={back.onClick}>
            <Icon name="chevronLeft" size={22} />
          </Button>
        ) : null}
        <span className={styles.brand}>{t.brand}</span>
      </span>
      {children}
    </header>
  );
}

export function HeaderLabel({ children }: { children: ReactNode }) {
  return <span className={styles.eyebrow}>{children}</span>;
}

/** Several header actions side by side. */
export function HeaderActions({ children }: { children: ReactNode }) {
  return <span className={styles.actions}>{children}</span>;
}
