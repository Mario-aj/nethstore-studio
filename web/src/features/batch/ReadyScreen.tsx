import { useCallback, useEffect, useRef, useState } from 'react';
import { photoUrls } from '../../shared/api/endpoints';
import type { Batch } from '../../shared/api/schemas';
import { joinNumbers } from '../../shared/lib/format';
import {
  canShareFiles,
  delay,
  fallbackFilename,
  fetchStampedFile,
  saveFile,
  SHARE_GROUP,
} from '../../shared/lib/files';
import { t } from '../../shared/i18n/pt-AO';
import { Banner } from '../../shared/ui/Banner';
import { Button } from '../../shared/ui/Button';
import { StatusIcon } from '../../shared/ui/Icon';
import { PhotoTile } from '../../shared/ui/PhotoTile';
import type { EffectivePhoto } from './processingView';
import styles from './BatchPage.module.css';

interface ReadyScreenProps {
  batch: Batch;
  ready: EffectivePhoto[];
  failed: EffectivePhoto[];
  total: number;
  retrying: boolean;
  onRetryFailed: () => void;
  onNewGroup: () => void;
}

function failureReason(failed: EffectivePhoto[]): string {
  const steps = new Set(
    failed.map((p) => (p.errorCode === 'invalid_image' ? 'invalid_image' : p.failedStep)),
  );
  if (steps.size !== 1) return t.ready.reasons.mixed;
  const only = [...steps][0];
  if (only === 'invalid_image') return t.ready.reasons.invalid_image;
  if (only === 'upload' || only === 'prepare' || only === 'stamp') return t.ready.reasons[only];
  return t.ready.reasons.mixed;
}

export function ReadyScreen({
  batch,
  ready,
  failed,
  total,
  retrying,
  onRetryFailed,
  onNewGroup,
}: ReadyScreenProps) {
  const files = useRef(new Map<string, Promise<File>>());
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [shareOffset, setShareOffset] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shareSupported] = useState(canShareFiles);

  const fileOf = useCallback(
    (photo: EffectivePhoto) => {
      let pending = files.current.get(photo.id);
      if (!pending) {
        pending = fetchStampedFile(photo.id, fallbackFilename(batch.seq, photo.position));
        pending.catch(() => files.current.delete(photo.id));
        files.current.set(photo.id, pending);
      }
      return pending;
    },
    [batch.seq],
  );

  // Fetch the next share group ahead of time: navigator.share must run soon after the tap.
  useEffect(() => {
    if (!shareSupported) return;
    for (const photo of ready.slice(shareOffset, shareOffset + SHARE_GROUP))
      void fileOf(photo).catch(() => undefined);
  }, [ready, shareOffset, shareSupported, fileOf]);

  const saveAll = async () => {
    setFeedback(null);
    setSaved(false);
    try {
      for (let i = 0; i < ready.length; i += 1) {
        const photo = ready[i];
        if (!photo) continue;
        setSaving({ done: i + 1, total: ready.length });
        saveFile(await fileOf(photo));
        await delay(350);
      }
      setSaved(true);
    } catch {
      setFeedback(t.ready.saveFailed);
    } finally {
      setSaving(null);
    }
  };

  const share = async () => {
    setFeedback(null);
    if (!shareSupported) {
      setFeedback(t.ready.shareUnsupported);
      return;
    }
    const group = ready.slice(shareOffset, shareOffset + SHARE_GROUP);
    try {
      const groupFiles = await Promise.all(group.map(fileOf));
      await navigator.share({ files: groupFiles });
      const next = shareOffset + SHARE_GROUP;
      setShareOffset(next >= ready.length ? 0 : next);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFeedback(t.ready.shareFailed);
    }
  };

  const remainingToShare = Math.min(SHARE_GROUP, ready.length - shareOffset);
  const firstFailed = failed[0];

  return (
    <>
      <div className={styles.readyIntro}>
        <div className={styles.readyTitleRow}>
          <StatusIcon kind="done" size={26} />
          <h1 className={styles.readyTitle}>{t.ready.title}</h1>
        </div>
        <p className={styles.summary}>
          <strong>{ready.length}</strong> {t.ready.summary(total)} · {batch.stampLine1} ·{' '}
          <span className={styles.summaryPrice}>{batch.stampLine2}</span>
        </p>
      </div>

      <ul className={styles.grid} aria-label={t.ready.gridLabel}>
        {ready.map((photo) => (
          <li key={photo.id}>
            <PhotoTile
              small
              src={`${photoUrls.thumb(photo.id)}?v=s`}
              alt={t.processing.readyAlt(photo.position)}
            />
          </li>
        ))}
      </ul>

      {firstFailed ? (
        <section className={styles.failures} aria-label={t.ready.failuresLabel}>
          <div className={styles.failThumb}>
            <PhotoTile
              small
              state="error"
              src={firstFailed.failedStep === 'stamp' ? `${photoUrls.thumb(firstFailed.id)}?v=p` : null}
              alt={t.processing.failedAlt(firstFailed.position)}
            />
          </div>
          <div className={styles.failText}>
            <strong>{t.ready.failedTitle(failed.length)}</strong>
            <span>
              {t.ready.failedLine(
                joinNumbers(failed.map((p) => p.position)),
                failed.length,
                failureReason(failed),
              )}
            </span>
          </div>
          <Button variant="outlineSmall" icon="refresh" iconSize={16} onClick={onRetryFailed} busy={retrying}>
            {t.common.retry}
          </Button>
        </section>
      ) : null}

      {feedback ? <Banner tone="error" icon="info" title={feedback} className={styles.feedback} /> : null}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Button
            block
            icon={saved ? 'check' : 'download'}
            iconSize={20}
            busy={saving !== null}
            onClick={() => void saveAll()}
            disabled={ready.length === 0}
          >
            {saving ? t.ready.saving(saving.done, saving.total) : saved ? t.ready.saved : t.ready.save}
          </Button>
          <div className={styles.footerGrid}>
            <Button
              variant="outlineMd"
              icon="share"
              onClick={() => void share()}
              disabled={ready.length === 0}
            >
              {shareOffset === 0 ? t.ready.share : t.ready.shareNext(remainingToShare)}
            </Button>
            <Button variant="outlineMd" icon="plus" onClick={onNewGroup}>
              {t.ready.newGroup}
            </Button>
          </div>
        </div>
      </footer>
    </>
  );
}
