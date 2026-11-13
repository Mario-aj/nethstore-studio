import { t } from '../shared/i18n/pt-AO';
import { LinkButton } from '../shared/ui/Button';
import styles from './App.module.css';

export function NotFoundPage() {
  return (
    <main className={styles.notFound}>
      <span className={styles.brand}>{t.brand}</span>
      <h1>{t.notFound.title}</h1>
      <p>{t.notFound.body}</p>
      <LinkButton to="/" variant="outline">
        {t.notFound.home}
      </LinkButton>
    </main>
  );
}
