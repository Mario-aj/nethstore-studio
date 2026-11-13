import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}

/** Bottom sheet on a native <dialog> opened with showModal() (SPEC 11.3). */
export function Sheet({ open, onClose, labelledBy, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself, outside its box.
        const dialog = ref.current;
        if (!dialog || event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!inside) onClose();
      }}
    >
      {open ? (
        <>
          <span className={styles.handle} aria-hidden="true" />
          {children}
        </>
      ) : null}
    </dialog>
  );
}
