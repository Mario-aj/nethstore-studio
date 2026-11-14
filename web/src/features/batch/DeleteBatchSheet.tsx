import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { isApiError } from '../../shared/api/client';
import { api } from '../../shared/api/endpoints';
import { t } from '../../shared/i18n/pt-AO';
import { Button } from '../../shared/ui/Button';
import { Sheet } from '../../shared/ui/Sheet';
import styles from './DeleteBatchSheet.module.css';

interface DeleteBatchSheetProps {
  open: boolean;
  batchId: string;
  photoCount: number;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Asks before deleting a batch (DECISOES.md, "Apagar lote"): the API removes its
 * rows and every object in storage, so there is no way back.
 */
export function DeleteBatchSheet({ open, batchId, photoCount, onClose, onDeleted }: DeleteBatchSheetProps) {
  const titleId = useId();
  const remove = useMutation({
    mutationFn: async () => {
      try {
        await api.deleteBatch(batchId);
      } catch (error) {
        // Already gone (deleted in another tab or by retention): nothing left to do.
        if (isApiError(error) && error.code === 'not_found') return;
        throw error;
      }
    },
    onSuccess: onDeleted,
  });

  const close = () => {
    if (remove.isPending) return;
    remove.reset();
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} labelledBy={titleId}>
      <div className={styles.heading}>
        <h2 id={titleId} className={styles.title}>
          {t.ready.deleteTitle}
        </h2>
        <p className={styles.body}>{t.ready.deleteBody(photoCount)}</p>
      </div>
      {remove.isError ? (
        <p className={styles.error} role="alert">
          {t.ready.deleteFailed}
        </p>
      ) : null}
      <div className={styles.actions}>
        {/* First in the dialog, so it gets the initial focus instead of the destructive action. */}
        <Button variant="outline" onClick={close} disabled={remove.isPending}>
          {t.ready.deleteCancel}
        </Button>
        <Button variant="danger" icon="trash" busy={remove.isPending} onClick={() => remove.mutate()}>
          {t.ready.deleteConfirm}
        </Button>
      </div>
    </Sheet>
  );
}
