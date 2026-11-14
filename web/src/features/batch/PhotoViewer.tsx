import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { photoUrls } from '../../shared/api/endpoints';
import { t } from '../../shared/i18n/pt-AO';
import { Icon } from '../../shared/ui/Icon';
import styles from './PhotoViewer.module.css';

export interface ViewerPhoto {
  id: string;
  position: number;
}

interface PhotoViewerProps<P extends ViewerPhoto> {
  photos: readonly P[];
  /** Index in `photos` of the open photo; null keeps the viewer closed. */
  index: number | null;
  /** Called when the strip settles on another photo (swipe, arrows or keys). */
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Actions for the photo on screen. */
  footer?: (photo: P) => ReactNode;
}

/** Quiet time after the last scroll event before the strip counts as settled. */
const SETTLE_MS = 120;
/** Slides on each side of the current one that load the full stamped image. */
const FULL_RANGE = 1;
/** Slides on each side that show the (already cached) thumbnail as a placeholder. */
const THUMB_RANGE = 3;

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));

/**
 * Full-screen viewer for the stamped photos. The strip is a native horizontal
 * scroller with mandatory snapping, so swiping keeps the platform's own feel
 * (momentum, rubber band) on iOS and Android; arrows and keys scroll it too.
 */
export function PhotoViewer<P extends ViewerPhoto>({
  photos,
  index,
  onIndexChange,
  onClose,
  footer,
}: PhotoViewerProps<P>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const open = index !== null && photos.length > 0;
  const last = photos.length - 1;

  const [live, setLive] = useState(() => clamp(index ?? 0, last));
  // Index last told to (or received from) the parent, so its echo is not scrolled to again.
  const reported = useRef(live);
  // Target of a scroll we started; scroll events are not "the user moved" until it settles.
  const programmatic = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const onIndexChangeRef = useRef(onIndexChange);
  const indexRef = useRef(index);

  useLayoutEffect(() => {
    onIndexChangeRef.current = onIndexChange;
    indexRef.current = index;
  });

  function scrollToIndex(target: number, behavior: ScrollBehavior) {
    const track = trackRef.current;
    if (!track) return;
    const left = target * track.clientWidth;
    if (Math.abs(track.scrollLeft - left) < 1) {
      programmatic.current = null;
      return;
    }
    programmatic.current = target;
    if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior });
    else track.scrollLeft = left;
  }

  // Open and close the native dialog; on opening, jump straight to the tapped photo.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const start = clamp(indexRef.current ?? 0, photos.length - 1);
      reported.current = start;
      setLive(start);
      scrollToIndex(start, 'instant');
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, photos.length]);

  // The parent moved to another photo (for example browser back/forward).
  useEffect(() => {
    if (!open || index === null || index === reported.current) return;
    const target = clamp(index, photos.length - 1);
    reported.current = target;
    setLive(target);
    scrollToIndex(target, 'smooth');
  }, [open, index, photos.length]);

  // The page behind must not scroll while the viewer is open (iOS scrolls it otherwise).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const indexFromScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return null;
    return clamp(Math.round(track.scrollLeft / track.clientWidth), photos.length - 1);
  };

  const onScroll = () => {
    const now = indexFromScroll();
    if (now === null) return;
    if (programmatic.current === null) setLive(now);
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      programmatic.current = null;
      const settled = indexFromScroll();
      if (settled === null) return;
      setLive(settled);
      if (settled !== reported.current) {
        reported.current = settled;
        onIndexChangeRef.current(settled);
      }
    }, SETTLE_MS);
  };

  const goTo = (target: number) => {
    const next = clamp(target, last);
    if (next === live) return;
    setLive(next);
    reported.current = next;
    onIndexChange(next);
    scrollToIndex(next, 'smooth');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(live + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(live - 1);
    }
  };

  const current = photos[clamp(live, last)];

  return (
    <dialog
      ref={dialogRef}
      className={styles.viewer}
      aria-label={t.viewer.label}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && current ? (
        <>
          <header className={styles.top}>
            <p className={styles.counter} aria-live="polite">
              {t.viewer.counter(live + 1, photos.length)}
            </p>
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t.viewer.close}>
              <Icon name="close" size={22} strokeWidth={1.6} />
            </button>
          </header>

          <div className={styles.stage}>
            <div
              ref={trackRef}
              className={styles.track}
              onScroll={onScroll}
              // A scroller must be reachable by keyboard; the arrow keys are handled on the dialog.
              tabIndex={0}
              role="region"
              aria-label={t.viewer.track}
              data-testid="viewer-track"
            >
              {photos.map((photo, i) => {
                const distance = Math.abs(i - live);
                return (
                  <figure
                    key={photo.id}
                    className={styles.slide}
                    aria-label={t.viewer.slide(i + 1, photos.length)}
                    aria-hidden={i === live ? undefined : true}
                  >
                    {distance <= THUMB_RANGE ? (
                      <img
                        className={styles.image}
                        src={`${photoUrls.thumb(photo.id)}?v=s`}
                        alt=""
                        decoding="async"
                      />
                    ) : null}
                    {distance <= FULL_RANGE ? (
                      <FullImage
                        src={photoUrls.stamped(photo.id)}
                        alt={t.processing.readyAlt(photo.position)}
                      />
                    ) : null}
                  </figure>
                );
              })}
            </div>
            <button
              type="button"
              className={`${styles.nav} ${styles.prev}`}
              onClick={() => goTo(live - 1)}
              disabled={live === 0}
              aria-label={t.viewer.previous}
            >
              <Icon name="chevronLeft" size={24} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className={`${styles.nav} ${styles.next}`}
              onClick={() => goTo(live + 1)}
              disabled={live === last}
              aria-label={t.viewer.next}
            >
              <Icon name="chevronRight" size={24} strokeWidth={1.6} />
            </button>
          </div>

          {footer ? (
            <footer className={styles.bottom}>
              <div className={styles.bottomInner}>{footer(current)}</div>
            </footer>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}

/** The full stamped image fades in over the thumbnail once it has loaded. */
function FullImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={`${styles.image} ${styles.full} ${loaded ? styles.loaded : ''}`}
      src={src}
      alt={alt}
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  );
}
