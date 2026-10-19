import type { ReactNode } from 'react';
import { Button } from './Button';
import { FormError } from './form';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra inputs (e.g. a required reason). */
  children?: ReactNode;
  confirmDisabled?: boolean;
}

/** Explicit confirmation before destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Bekor qilish',
  tone = 'danger',
  loading = false,
  error,
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-[15px] text-ink-secondary">{message}</div>
        {children}
        <FormError message={error} />
      </div>
    </Modal>
  );
}
