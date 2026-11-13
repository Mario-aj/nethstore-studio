import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../shared/i18n/pt-AO';
import { Button } from '../shared/ui/Button';
import styles from './App.module.css';

/** "Nova versão disponível" with "Atualizar" when a new service worker is waiting (SPEC 11.5). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;
  return (
    <div className={styles.update} role="status">
      <p>{t.update.title}</p>
      <Button variant="text" onClick={() => setNeedRefresh(false)}>
        {t.update.dismiss}
      </Button>
      <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
        {t.update.action}
      </Button>
    </div>
  );
}
