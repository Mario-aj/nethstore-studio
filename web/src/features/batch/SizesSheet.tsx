import { useId, useState } from 'react';
import { t } from '../../shared/i18n/pt-AO';
import { canonicalSizes, normalizeDescription, SIZES, stampLines, type Size } from '../../shared/lib/stamp';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { Sheet } from '../../shared/ui/Sheet';
import styles from './SizesSheet.module.css';

interface SizesSheetProps {
  open: boolean;
  sizes: readonly Size[];
  description: string;
  onApply: (sizes: Size[]) => void;
  onClose: () => void;
}

/** Bottom sheet with the six size chips (multi select), stamp preview, Limpar and Aplicar. */
export function SizesSheet({ open, sizes, description, onApply, onClose }: SizesSheetProps) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId}>
      <SizesForm titleId={titleId} initial={sizes} description={description} onApply={onApply} />
    </Sheet>
  );
}

function SizesForm({
  titleId,
  initial,
  description,
  onApply,
}: {
  titleId: string;
  initial: readonly Size[];
  description: string;
  onApply: (sizes: Size[]) => void;
}) {
  // Mounted only while the sheet is open, so the draft starts from the applied sizes.
  const [draft, setDraft] = useState<Size[]>(() => [...initial]);
  const toggle = (size: Size) =>
    setDraft((current) =>
      canonicalSizes(current.includes(size) ? current.filter((s) => s !== size) : [...current, size]),
    );
  const preview =
    draft.length > 0
      ? stampLines({ priceKz: 0, sizes: draft, description: normalizeDescription(description) }).line1
      : t.sheet.previewEmpty;

  return (
    <>
      <div className={styles.heading}>
        <h2 id={titleId} className={styles.title}>
          {t.sheet.title}
        </h2>
        <p className={styles.subtitle}>{t.sheet.subtitle}</p>
      </div>
      <div className={styles.chips} role="group" aria-labelledby={titleId}>
        {SIZES.map((size) => {
          const on = draft.includes(size);
          return (
            <button
              key={size}
              type="button"
              className={styles.chip}
              aria-pressed={on}
              onClick={() => toggle(size)}
            >
              {on ? <Icon name="check" size={16} strokeWidth={2} /> : null}
              {size}
            </button>
          );
        })}
      </div>
      <p className={styles.preview} aria-live="polite">
        {t.sheet.preview} <strong>{preview}</strong>
      </p>
      <div className={styles.actions}>
        <Button variant="outline" onClick={() => setDraft([])}>
          {t.sheet.clear}
        </Button>
        <Button variant="primary" onClick={() => onApply(draft)}>
          {t.sheet.apply}
        </Button>
      </div>
    </>
  );
}
