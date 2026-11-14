import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { photoUrls } from '../../shared/api/endpoints';
import type { Batch } from '../../shared/api/schemas';
import { joinNumbers } from '../../shared/lib/format';
import {
  canShareFiles,
  delay,
  fallbackFilename,
  fetchStampedFile,
  isAbort,
  saveFile,
  saveMode,
  SHARE_GROUP,
} from '../../shared/lib/files';
import { t } from '../../shared/i18n/pt-AO';
import { Banner } from '../../shared/ui/Banner';
import { Button } from '../../shared/ui/Button';
import { StatusIcon } from '../../shared/ui/Icon';
import { PhotoTile } from '../../shared/ui/PhotoTile';
import { PhotoViewer } from './PhotoViewer';
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

/** Search parameter with the number of the photo open in the viewer, so "back" closes it. */
const VIEWER_PARAM = 'foto';

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
  const [prepared, setPrepared] = useState<ReadonlySet<string>>(() => new Set());
  const [mode] = useState(saveMode);
  const [shareSupported] = useState(canShareFiles);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // download mode: progress of the sequential downloads.
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  // share mode (iOS): photos go to the share sheet, all at once or 10 at a time after a refusal.
  const [saveGroup, setSaveGroup] = useState(Number.POSITIVE_INFINITY);
  const [saveOffset, setSaveOffset] = useState(0);
  const [sharingAll, setSharingAll] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const [shareOffset, setShareOffset] = useState(0);

  const fileOf = useCallback(
    (photo: EffectivePhoto) => {
      let pending = files.current.get(photo.id);
      if (!pending) {
        pending = fetchStampedFile(photo.id, fallbackFilename(batch.seq, photo.position));
        files.current.set(photo.id, pending);
        // Handled here, so prefetching callers can drop the promise (`void fileOf(...)`).
        pending.then(
          () => setPrepared((current) => new Set(current).add(photo.id)),
          () => {
            files.current.delete(photo.id);
            setPrepareFailed(true);
          },
        );
      }
      return pending;
    },
    [batch.seq],
  );

  const saveBatch = mode === 'share' ? ready.slice(saveOffset, saveOffset + saveGroup) : ready;
  const preparedInBatch = saveBatch.filter((p) => prepared.has(p.id)).length;
  const preparing = mode === 'share' && !prepareFailed && preparedInBatch < saveBatch.length;

  // navigator.share must run right after the tap, so the files it sends are fetched
  // ahead of time: on iOS every photo (one share saves them all), elsewhere the next group.
  useEffect(() => {
    if (mode !== 'share') return;
    for (const photo of saveBatch) void fileOf(photo);
  }, [mode, saveBatch, fileOf]);

  useEffect(() => {
    if (!shareSupported) return;
    for (const photo of ready.slice(shareOffset, shareOffset + SHARE_GROUP)) void fileOf(photo);
  }, [ready, shareOffset, shareSupported, fileOf]);

  const saveAllByDownload = async () => {
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

  const saveAllByShare = async () => {
    setFeedback(null);
    setSaved(false);
    setPrepareFailed(false);
    setSharingAll(true);
    try {
      let batchFiles: File[];
      try {
        batchFiles = await Promise.all(saveBatch.map(fileOf));
      } catch {
        setPrepareFailed(true);
        setFeedback(t.ready.saveFailed);
        return;
      }
      let size = batchFiles.length;
      if (size > SHARE_GROUP && !navigator.canShare({ files: batchFiles })) {
        size = SHARE_GROUP;
        batchFiles = batchFiles.slice(0, SHARE_GROUP);
        setSaveGroup(SHARE_GROUP);
      }
      try {
        await navigator.share({ files: batchFiles });
      } catch (error) {
        if (isAbort(error)) return;
        if (size > SHARE_GROUP) {
          setSaveGroup(SHARE_GROUP);
          setFeedback(t.ready.saveInGroups);
        } else {
          setFeedback(t.ready.saveFailed);
        }
        return;
      }
      const next = saveOffset + size;
      if (next >= ready.length) {
        setSaveOffset(0);
        setSaved(true);
      } else {
        setSaveOffset(next);
      }
    } finally {
      setSharingAll(false);
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
      if (isAbort(error)) return;
      setFeedback(t.ready.shareFailed);
    }
  };

  // Viewer ----------------------------------------------------------------------
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const openedHere = useRef(false);
  const viewerParam = params.get(VIEWER_PARAM);
  const viewerIndex = viewerParam === null ? -1 : ready.findIndex((p) => String(p.position) === viewerParam);
  const viewerPhoto = viewerIndex >= 0 ? ready[viewerIndex] : undefined;
  const [viewerBusy, setViewerBusy] = useState<'save' | 'share' | null>(null);
  const [viewerFeedback, setViewerFeedback] = useState<string | null>(null);
  const [savedOne, setSavedOne] = useState<string | null>(null);

  // The photo on screen is fetched ahead so "Guardar" and "Partilhar" answer at once.
  useEffect(() => {
    if (viewerPhoto) void fileOf(viewerPhoto);
  }, [viewerPhoto, fileOf]);

  const openViewer = (photo: EffectivePhoto) => {
    openedHere.current = true;
    setViewerFeedback(null);
    setParams({ [VIEWER_PARAM]: String(photo.position) });
  };

  const changeViewer = (index: number) => {
    const photo = ready[index];
    if (!photo) return;
    setViewerFeedback(null);
    setParams({ [VIEWER_PARAM]: String(photo.position) }, { replace: true });
  };

  const closeViewer = () => {
    if (openedHere.current) {
      openedHere.current = false;
      void navigate(-1);
    } else {
      setParams({}, { replace: true });
    }
  };

  const saveOne = async (photo: EffectivePhoto) => {
    setViewerFeedback(null);
    setViewerBusy('save');
    try {
      const file = await fileOf(photo);
      if (mode === 'share') await navigator.share({ files: [file] });
      else saveFile(file);
      setSavedOne(photo.id);
    } catch (error) {
      if (!isAbort(error)) setViewerFeedback(t.viewer.saveFailed);
    } finally {
      setViewerBusy(null);
    }
  };

  const shareOne = async (photo: EffectivePhoto) => {
    setViewerFeedback(null);
    setViewerBusy('share');
    try {
      await navigator.share({ files: [await fileOf(photo)] });
    } catch (error) {
      if (!isAbort(error)) setViewerFeedback(t.viewer.shareFailed);
    } finally {
      setViewerBusy(null);
    }
  };

  const remainingToShare = Math.min(SHARE_GROUP, ready.length - shareOffset);
  const firstFailed = failed[0];

  let saveLabel: string = saved ? t.ready.saved : t.ready.save;
  if (mode === 'share') {
    if (preparing) saveLabel = t.ready.preparing(preparedInBatch, saveBatch.length);
    else if (saveOffset > 0 || (!saved && saveBatch.length < ready.length))
      saveLabel = t.ready.saveNext(saveBatch.length);
  } else if (saving) {
    saveLabel = t.ready.saving(saving.done, saving.total);
  }
  const saveBusy = mode === 'share' ? preparing || sharingAll : saving !== null;

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
            <button
              type="button"
              className={styles.tileButton}
              onClick={() => openViewer(photo)}
              aria-label={t.viewer.open(photo.position)}
            >
              <PhotoTile
                small
                src={`${photoUrls.thumb(photo.id)}?v=s`}
                alt={t.processing.readyAlt(photo.position)}
              />
            </button>
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
            busy={saveBusy}
            onClick={() => void (mode === 'share' ? saveAllByShare() : saveAllByDownload())}
            disabled={ready.length === 0}
          >
            {saveLabel}
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

      <PhotoViewer
        photos={ready}
        index={viewerIndex >= 0 ? viewerIndex : null}
        onIndexChange={changeViewer}
        onClose={closeViewer}
        footer={(photo) => (
          <div className={styles.viewerActions}>
            {viewerFeedback ? (
              <p className={styles.viewerFeedback} role="alert">
                {viewerFeedback}
              </p>
            ) : null}
            <div className={styles.viewerButtons}>
              <Button
                variant="outlineMd"
                icon={savedOne === photo.id ? 'check' : 'download'}
                busy={viewerBusy === 'save'}
                disabled={viewerBusy !== null}
                onClick={() => void saveOne(photo)}
              >
                {savedOne === photo.id ? t.viewer.saved : t.viewer.save}
              </Button>
              {shareSupported ? (
                <Button
                  variant="outlineMd"
                  icon="share"
                  busy={viewerBusy === 'share'}
                  disabled={viewerBusy !== null}
                  onClick={() => void shareOne(photo)}
                >
                  {t.viewer.share}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      />
    </>
  );
}
