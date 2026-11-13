import { photoUrls } from '../../shared/api/endpoints';
import { deployText, t, type DeployMode } from '../../shared/i18n/pt-AO';
import { Banner, Notice } from '../../shared/ui/Banner';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { PhotoTile } from '../../shared/ui/PhotoTile';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { StepItem } from '../../shared/ui/StepItem';
import type { ProcessingView } from './processingView';
import styles from './BatchPage.module.css';

interface ProcessingScreenProps {
  view: ProcessingView;
  mode: DeployMode;
  retryInSeconds: number | null;
  reconnected: { next: number; total: number } | null;
  hiddenWarning: boolean;
  needPickCount: number;
  retrying: boolean;
  onRetryFailed: () => void;
  onContinue: () => void;
  onNewGroup: () => void;
  onDismissHidden: () => void;
}

export function ProcessingScreen({
  view,
  mode,
  retryInSeconds,
  reconnected,
  hiddenWarning,
  needPickCount,
  retrying,
  onRetryFailed,
  onContinue,
  onNewGroup,
  onDismissHidden,
}: ProcessingScreenProps) {
  const text = deployText(mode);
  const failedCount = view.failed.length;
  const showFooter = view.phase === 'failed';

  return (
    <>
      <section className={styles.status} aria-live="polite">
        <ProgressRing
          value={view.pct}
          paused={view.ringPaused}
          label={t.processing.ringLabel}
          caption={view.caption}
        />
        <h1 className={styles.title}>{view.title}</h1>

        {view.phase === 'offline' ? (
          <Banner tone="error" icon="wifiOff" title={text.offlineTitle}>
            {text.offlineBody}{' '}
            <span className="tabular">{t.processing.reconnectIn(retryInSeconds ?? 8)}</span>.
          </Banner>
        ) : null}
        {reconnected && view.phase === 'uploading' ? (
          <Banner tone="success" icon="wifi" title={t.processing.reconnected} role="status">
            {t.processing.reconnectedBody(reconnected.next, reconnected.total)}
          </Banner>
        ) : null}
        {hiddenWarning ? (
          <Banner
            tone="error"
            icon="info"
            title={t.processing.hiddenTitle}
            trailing={
              <Button variant="iconOnly" aria-label={t.common.close} onClick={onDismissHidden}>
                <Icon name="close" size={18} />
              </Button>
            }
          >
            {t.processing.hiddenBody}
          </Banner>
        ) : null}
        {view.message ? <Notice tone={view.message.tone}>{view.message.text}</Notice> : null}
      </section>

      <ol className={styles.steps} aria-label="Etapas">
        {view.steps.map((step) => (
          <StepItem key={step.key} state={step.state} label={step.label} count={step.count} />
        ))}
      </ol>

      <section className={styles.readySection} aria-labelledby="ja-prontas">
        <div className={styles.readyHead}>
          <h2 id="ja-prontas" className={styles.sectionLabel}>
            {t.processing.readyHeading} · <span>{view.ready.length}</span>
          </h2>
          {failedCount > 0 ? (
            <button type="button" className={styles.failLink} onClick={onRetryFailed} disabled={retrying}>
              {t.processing.failedRetry(failedCount)}
              <Icon name="refresh" size={15} strokeWidth={1.7} />
            </button>
          ) : null}
        </div>
        {view.ready.length === 0 && failedCount === 0 ? (
          <p className={styles.readyEmpty}>{t.processing.readyEmpty}</p>
        ) : null}
        {view.ready.length + failedCount > 0 ? (
          <ul className={styles.readyStrip} aria-label={t.processing.readyHeading} tabIndex={0}>
            {view.ready.map((photo) => (
              <li key={photo.id}>
                <PhotoTile
                  small
                  src={`${photoUrls.thumb(photo.id)}?v=s`}
                  alt={t.processing.readyAlt(photo.position)}
                />
              </li>
            ))}
            {view.failed.map((photo) => (
              <li key={photo.id}>
                <PhotoTile
                  small
                  state="error"
                  src={photo.failedStep === 'stamp' ? `${photoUrls.thumb(photo.id)}?v=p` : null}
                  alt={t.processing.failedAlt(photo.position)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {needPickCount > 0 ? (
        <Banner
          tone="error"
          icon="image"
          title={t.processing.chooseAgain(needPickCount)}
          className={styles.pickNote}
          role="status"
        >
          {t.processing.chooseAgainHint(needPickCount)}
        </Banner>
      ) : null}

      {showFooter ? (
        <footer className={styles.footer}>
          <div className={`${styles.footerInner} ${styles.footerRow}`}>
            {view.ready.length > 0 ? (
              <Button variant="outline" onClick={onContinue}>
                {t.processing.continueWith(view.ready.length)}
              </Button>
            ) : (
              <Button variant="outline" onClick={onNewGroup}>
                {t.processing.newGroup}
              </Button>
            )}
            <Button icon="refresh" onClick={onRetryFailed} busy={retrying}>
              {t.processing.retryN(failedCount)}
            </Button>
          </div>
        </footer>
      ) : null}
    </>
  );
}
