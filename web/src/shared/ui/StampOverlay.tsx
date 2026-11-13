import styles from './StampOverlay.module.css';

/**
 * Two-line stamp drawn over a photo, for illustrations only (the real stamp is burned
 * in by the API). `size` is relative to the photo width, e.g. "5cqi"; the parent needs
 * `container-type: inline-size`.
 */
export function StampOverlay({ line1, line2, size }: { line1: string; line2: string; size: string }) {
  return (
    <span className={styles.stamp} style={{ fontSize: size }} aria-hidden="true">
      {line1}
      <br />
      {line2}
    </span>
  );
}
