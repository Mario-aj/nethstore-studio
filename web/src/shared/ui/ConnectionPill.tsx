import { t } from '../i18n/pt-AO';
import styles from './ConnectionPill.module.css';

export type Connection = 'online' | 'offline' | 'unknown';

export function ConnectionPill({ status }: { status: Connection }) {
  return (
    <span role="status" className={`${styles.pill} ${styles[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {status === 'offline' ? t.common.disconnected : t.common.connected}
    </span>
  );
}
