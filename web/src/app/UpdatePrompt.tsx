import { useEffect, useRef, useState } from 'react';
import { t } from '../shared/i18n/pt-AO';
import { useWorkInProgress } from '../shared/lib/workInProgress';
import { Button } from '../shared/ui/Button';
import { watchForUpdates, type UpdateWatch } from './serviceWorkerUpdates';
import styles from './App.module.css';

/**
 * "Nova versão disponível" with "Atualizar" when a new service worker is waiting
 * (SPEC 11.5; DECISOES.md, "Atualizações da app"). Hidden while photos are being sent,
 * and "Agora não" only lasts until the app leaves the screen and comes back.
 */
export function UpdatePrompt() {
  const watch = useRef<UpdateWatch | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);
  const busy = useWorkInProgress();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const current = watchForUpdates({
      onUpdateReady: () => {
        setReady(true);
        setDismissed(false);
      },
    });
    watch.current = current;
    return () => current.stop();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setDismissed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!ready || dismissed || busy) return null;
  return (
    <div className={styles.update} role="status">
      <p>{t.update.title}</p>
      <Button variant="text" onClick={() => setDismissed(true)} disabled={applying}>
        {t.update.dismiss}
      </Button>
      <Button
        variant="primary"
        busy={applying}
        onClick={() => {
          setApplying(true);
          watch.current?.apply();
        }}
      >
        {t.update.action}
      </Button>
    </div>
  );
}
