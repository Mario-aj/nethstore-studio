import { useId, useState } from 'react';
import { t } from '../../shared/i18n/pt-AO';
import { Icon } from '../../shared/ui/Icon';
import { StampOverlay } from '../../shared/ui/StampOverlay';
import type { Photo } from './photos';
import styles from './Landing.module.css';

/** Depois/Antes comparator: draggable champagne divider, keyboard accessible via a range input. */
export function CompareSlider({ photo }: { photo: Photo }) {
  const [position, setPosition] = useState(50);
  const descriptionId = useId();
  return (
    <div className={styles.compareFrame}>
      <div className={styles.compare} role="group" aria-describedby={descriptionId}>
        <p id={descriptionId} className="visually-hidden">
          {t.landing.stamp.compareLabel}
        </p>
        <img
          className={styles.compareImg}
          src={photo.src}
          srcSet={photo.srcSet}
          sizes="(min-width: 1200px) 520px, (min-width: 768px) 700px, 100vw"
          alt=""
          loading="lazy"
        />
        <div className={styles.compareAfter} style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img
            className={styles.compareImg}
            src={photo.src}
            srcSet={photo.srcSet}
            sizes="(min-width: 1200px) 520px, (min-width: 768px) 700px, 100vw"
            alt=""
            loading="lazy"
          />
          <StampOverlay line1="Veste/ M e L" line2="10.000 kz" size="4.6cqi" />
        </div>
        <div className={styles.compareDivider} style={{ left: `${position}%` }} aria-hidden="true">
          <span className={styles.compareHandle}>
            <Icon name="compare" size={22} strokeWidth={1.8} />
          </span>
        </div>
        <span className={`${styles.compareTag} ${styles.compareTagLeft}`} aria-hidden="true">
          {t.landing.stamp.after}
        </span>
        <span className={`${styles.compareTag} ${styles.compareTagRight}`} aria-hidden="true">
          {t.landing.stamp.before}
        </span>
        <input
          className={styles.compareRange}
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          aria-label={t.landing.stamp.sliderLabel}
          aria-valuetext={`${position}% com carimbo`}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
