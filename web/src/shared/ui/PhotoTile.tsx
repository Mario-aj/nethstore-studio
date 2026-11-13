import { Icon, Spinner, StatusIcon } from './Icon';
import styles from './PhotoTile.module.css';

export type PhotoTileState = 'normal' | 'processing' | 'ready' | 'error';

interface PhotoTileProps {
  src: string | null;
  alt: string;
  state?: PhotoTileState;
  small?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/** 3:4 photo tile (FRONTEND-SPEC "Miniatura"): normal, processing, ready or error. */
export function PhotoTile({
  src,
  alt,
  state = 'normal',
  small = false,
  onRemove,
  removeLabel,
  className,
}: PhotoTileProps) {
  const classes = [styles.tile, small ? styles.thumb : null, styles[state], className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      {src ? (
        <img className={styles.img} src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <span className="visually-hidden">{alt}</span>
      )}
      {state === 'processing' ? (
        <span className={styles.center}>
          <Spinner size={small ? 20 : 28} />
        </span>
      ) : null}
      {state === 'error' ? (
        <span className={styles.center}>
          <StatusIcon kind="error" size={small ? 20 : 24} />
        </span>
      ) : null}
      {state === 'ready' && !small ? (
        <span className={styles.badge}>
          <StatusIcon kind="done" size={20} />
        </span>
      ) : null}
      {onRemove ? (
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={removeLabel}>
          <span className={styles.removeDot}>
            <Icon name="close" size={14} strokeWidth={2} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
