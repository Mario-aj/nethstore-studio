import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { isApiError } from '../../shared/api/client';
import { api, queryKeys } from '../../shared/api/endpoints';
import { useDeployMode } from '../../shared/hooks/useAppConfig';
import { useNow } from '../../shared/hooks/useNow';
import { useWakeLock } from '../../shared/hooks/useWakeLock';
import { formatShortDate } from '../../shared/lib/format';
import { errorMessage, t } from '../../shared/i18n/pt-AO';
import { AppHeader, HeaderLabel } from '../../shared/ui/AppHeader';
import { Banner } from '../../shared/ui/Banner';
import { LinkButton } from '../../shared/ui/Button';
import { processingView, type EffectivePhoto } from './processingView';
import { ProcessingScreen } from './ProcessingScreen';
import { ReadyScreen } from './ReadyScreen';
import { uploads, useUploads } from './uploads';
import styles from './BatchPage.module.css';

const POLL_MS = 1000;
const RECONNECTED_BANNER_MS = 5000;

export default function BatchPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mode = useDeployMode();
  const snapshot = useUploads();
  const batchUploads = snapshot.batches[id];
  const uploading = batchUploads?.active ?? false;

  const query = useQuery({
    queryKey: queryKeys.batch(id),
    queryFn: ({ signal }) => api.batch(id, signal),
    // SPEC 11.3: poll every second until the batch is finished (and our uploads are done).
    refetchInterval: (q) => (q.state.data?.finished && !uploading ? false : POLL_MS),
    refetchIntervalInBackground: true,
  });
  const batch = query.data;

  const [accepted, setAccepted] = useState(false);
  const [hiddenWarning, setHiddenWarning] = useState(false);
  const [needPick, setNeedPick] = useState<EffectivePhoto[]>([]);
  const pickerRef = useRef<HTMLInputElement>(null);
  const reconciled = useRef(false);

  useWakeLock(uploading);

  // When our uploads finish, the server state changed (photos confirmed or given up)
  // but the last poll may predate it and say `finished`, which stops polling. Fetch
  // once more so polling resumes until the server is really done (e.g. after Repetir).
  const wasUploading = useRef(uploading);
  useEffect(() => {
    if (wasUploading.current && !uploading) void query.refetch();
    wasUploading.current = uploading;
  }, [uploading, query]);

  // A page hidden during the upload may have frozen it: warn when coming back.
  useEffect(() => {
    if (!uploading) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setHiddenWarning(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uploading]);

  // After a reload the files of photos still awaiting upload are gone: report them as
  // failed in the upload step so the batch can finish, and offer to pick them again.
  useEffect(() => {
    if (!batch || reconciled.current) return;
    reconciled.current = true;
    const orphans = batch.photos.filter(
      (p) => p.status === 'awaiting_upload' && !uploads.has(batch.id, p.id),
    );
    if (orphans.length === 0) return;
    void Promise.allSettled(orphans.map((p) => api.uploadFailed(p.id))).then(() => query.refetch());
  }, [batch, query]);

  const now = useNow(snapshot.paused || snapshot.reconnectedAt !== null);
  const retryInSeconds =
    snapshot.retryAt === null ? null : Math.max(0, Math.ceil((snapshot.retryAt - now) / 1000));

  const retry = useMutation({
    mutationFn: async (photos: EffectivePhoto[]) => {
      for (const photo of photos) {
        if (photo.failedStep === 'upload') uploads.retry(id, photo.id);
        else await api.retryPhoto(photo.id);
      }
    },
    onSettled: () => {
      setAccepted(false);
      void query.refetch();
    },
  });

  if (query.isError && !batch) {
    const code = isApiError(query.error) ? query.error.code : 'unknown';
    return (
      <div className={styles.page}>
        <AppHeader compact />
        <div className={styles.notFound}>
          <p>{code === 'not_found' || code === 'invalid_id' ? t.processing.notFound : errorMessage(code)}</p>
          <LinkButton to="/estudio" variant="outline" icon="plus">
            {t.processing.newGroup}
          </LinkButton>
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className={styles.page} role="status">
        <AppHeader compact />
        <span className="visually-hidden">{t.common.loading}</span>
      </div>
    );
  }

  const view = processingView({ batch, uploads: batchUploads, paused: snapshot.paused, mode, accepted });
  const label = <HeaderLabel>{t.processing.header(formatShortDate(new Date(batch.createdAt)))}</HeaderLabel>;
  const newGroup = () => void navigate('/estudio');
  // The batch page no longer exists: replace it in the history, so "back" does not land on it.
  const onDeleted = () => {
    void navigate('/estudio', { replace: true, state: { batchDeleted: true } });
    queryClient.removeQueries({ queryKey: queryKeys.batch(id) });
  };

  const retryFailed = () => {
    const failed = view.failed;
    const pick = failed.filter((p) => p.failedStep === 'upload' && !p.hasLocalFile);
    const rest = failed.filter((p) => !pick.includes(p));
    if (pick.length > 0) {
      setNeedPick(pick);
      // Must run inside the tap for the browser to open the picker.
      pickerRef.current?.click();
    }
    if (rest.length > 0) retry.mutate(rest);
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    needPick.forEach((photo, index) => {
      const file = files[index];
      if (file) uploads.reselect(batch.id, photo.id, photo.position, file);
    });
    setNeedPick((current) => current.slice(files.length));
    setAccepted(false);
    void query.refetch();
  };

  const reconnected =
    snapshot.reconnectedAt !== null && now - snapshot.reconnectedAt < RECONNECTED_BANNER_MS && batchUploads
      ? {
          next: Math.min(batchUploads.doneCount + 1, batchUploads.items.length),
          total: batchUploads.items.length,
        }
      : null;

  const isReady = view.phase === 'done';
  const pageClass = [
    styles.page,
    isReady ? styles.withTallFooter : view.phase === 'failed' ? styles.withFooter : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={pageClass}>
      <AppHeader compact>{label}</AppHeader>
      {isReady ? (
        <ReadyScreen
          batch={batch}
          ready={view.ready}
          failed={view.failed}
          total={view.total}
          retrying={retry.isPending}
          onRetryFailed={retryFailed}
          onNewGroup={newGroup}
          onDeleted={onDeleted}
        />
      ) : (
        <ProcessingScreen
          view={view}
          mode={mode}
          retryInSeconds={retryInSeconds}
          reconnected={reconnected}
          hiddenWarning={hiddenWarning && uploading}
          needPickCount={needPick.length}
          retrying={retry.isPending}
          onRetryFailed={retryFailed}
          onContinue={() => setAccepted(true)}
          onNewGroup={newGroup}
          onDismissHidden={() => setHiddenWarning(false)}
        />
      )}
      {retry.isError ? (
        <Banner
          tone="error"
          icon="info"
          title={errorMessage(isApiError(retry.error) ? retry.error.code : 'unknown')}
          className={styles.feedback}
        />
      ) : null}
      <input
        ref={pickerRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        multiple
        onChange={onPicked}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="repick-input"
      />
    </div>
  );
}
