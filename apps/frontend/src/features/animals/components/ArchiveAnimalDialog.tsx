import { useEffect, useState } from 'react';
import { errorMessage } from '@/shared/api/errors';
import { ConfirmDialog, Field, Select, Textarea, toast } from '@/shared/ui';
import type { Animal } from '../api/animals.api';
import { ARCHIVE_REASONS } from '../lib/labels';
import { useArchiveAnimal } from '../model/animals.queries';

const MAX_REASON_LENGTH = 500;

/** Animals are never deleted: archiving keeps their history (treatments, files). */
export function ArchiveAnimalDialog({
  animal,
  onClose,
  onArchived,
}: {
  animal: Animal | null;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const archive = useArchiveAnimal();
  const [reason, setReason] = useState<string>(ARCHIVE_REASONS[0]);
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (animal) {
      setReason(ARCHIVE_REASONS[0]);
      setDetails('');
      archive.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animal]);

  const fullReason = (details.trim() ? `${reason}: ${details.trim()}` : reason).slice(0, MAX_REASON_LENGTH);

  return (
    <ConfirmDialog
      open={animal !== null}
      title="Hayvonni arxivlash"
      message={
        <>
          <strong className="text-ink">{animal?.tagNumber}</strong> raqamli hayvon faol ro‘yxatdan olinadi. Ma’lumotlari va tarixi
          arxivda saqlanib qoladi.
        </>
      }
      confirmLabel="Arxivlash"
      loading={archive.isPending}
      error={archive.error ? errorMessage(archive.error) : null}
      onCancel={onClose}
      onConfirm={() => {
        if (!animal || archive.isPending) return;
        archive.mutate(
          { id: animal.id, reason: fullReason },
          {
            onSuccess: () => {
              toast.success('Hayvon arxivlandi');
              onClose();
              onArchived?.();
            },
          },
        );
      }}
    >
      <Field label="Sabab" required>
        <Select value={reason} onChange={(event) => setReason(event.target.value)}>
          {ARCHIVE_REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Izoh" hint="Ixtiyoriy">
        <Textarea
          rows={2}
          maxLength={MAX_REASON_LENGTH - reason.length - 2}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
