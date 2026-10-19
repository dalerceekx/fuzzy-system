import { FlaskConical } from 'lucide-react';
import { Badge, type BadgeTone } from '@/shared/ui';
import type { Medicine, MedicineStatus } from '../api/medicines.api';

export const MEDICINE_STATUS_LABELS: Record<MedicineStatus, string> = {
  DRAFT: 'Qoralama',
  APPROVED: 'Tasdiqlangan',
  ARCHIVED: 'Arxivlangan',
};

const TONES: Record<MedicineStatus, BadgeTone> = { DRAFT: 'warning', APPROVED: 'success', ARCHIVED: 'neutral' };

export function MedicineStatusBadge({ status }: { status: MedicineStatus }) {
  return <Badge tone={TONES[status]}>{MEDICINE_STATUS_LABELS[status]}</Badge>;
}

/** Required notice for sample (DRAFT) medicines — never usable for treatment. */
export const SAMPLE_MEDICINE_WARNING = 'Namuna. Haqiqiy davolash uchun ishlatmang.';

export function SampleMedicineNotice({ medicine }: { medicine: Pick<Medicine, 'status' | 'isDemo'> }) {
  if (medicine.status !== 'DRAFT') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-warning">
      <FlaskConical aria-hidden className="size-4" />
      {medicine.isDemo ? SAMPLE_MEDICINE_WARNING : 'Tasdiqlanmagan. Davolash uchun ishlatmang.'}
    </span>
  );
}
