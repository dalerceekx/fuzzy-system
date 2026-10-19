import { useRef, useState } from 'react';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { errorMessage, toApiError } from '@/shared/api/errors';
import { Decimal } from '@/shared/lib/decimal';
import { newIdempotencyKey } from '@/shared/lib/idempotency';
import { decimalProblem } from '@/shared/lib/validation';
import { Alert, Badge, Button, Field, FormError, Input, Modal, toast } from '@/shared/ui';
import type { Ration } from '../api/rations.api';
import { issueAmount } from '../lib/ration-math';
import { useIssueRation } from '../model/rations.queries';

const DAYS_RULE = { maxIntegerDigits: 4, maxFractionDigits: 0, positive: true, max: '3650' };

interface ShortItem {
  inventoryItemId: string;
  name: string;
  required: string;
  available: string;
}

function shortItems(error: unknown): ShortItem[] {
  const apiError = toApiError(error);
  const items = apiError.code === 'INSUFFICIENT_STOCK' ? apiError.details?.items : undefined;
  return Array.isArray(items) ? (items as ShortItem[]) : [];
}

/**
 * The real consumption of N feeding days: every feed of the ration leaves
 * the warehouse in one all-or-nothing request (one Idempotency-Key per
 * dialog session, so a retried submit is applied once). `daily` is the
 * dashboard's "berildi" confirmation: exactly one day.
 */
export function IssueRationDialog({ ration, onClose, daily = false }: { ration: Ration; onClose: () => void; daily?: boolean }) {
  const issue = useIssueRation();
  const idempotencyKey = useRef(newIdempotencyKey());
  const [days, setDays] = useState('1');
  const problem = days.trim() ? decimalProblem(days, DAYS_RULE) : 'Kunlar sonini kiriting';
  const dayCount = problem ? null : Decimal.from(days);
  const presets = [...new Set(['1', '7', String(ration.days)])];

  const lines = ration.items.map((line) => {
    const required = dayCount ? issueAmount(Decimal.from(line.dailyPerAnimal), Decimal.from(ration.animalCount), dayCount) : null;
    const available = Decimal.from(line.item.quantity);
    return { line, required, available, short: required ? required.gt(available) : false };
  });
  const anyShort = lines.some((line) => line.short);
  const serverShort = shortItems(issue.error);
  const unitOf = (id: string) => ration.items.find((line) => line.inventoryItemId === id)?.item.unit ?? 'KG';

  function submit(): void {
    if (!dayCount || anyShort || issue.isPending) return;
    issue.mutate(
      { id: ration.id, days: dayCount.toNumber(), idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (result) => {
          toast.success(daily ? `“${ration.name}” bugun berildi` : `Sarf ombordan chiqarildi: ${result.days} kunlik ratsion`);
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={daily ? 'Bugungi ratsion berildimi?' : 'Sarfni ombordan chiqarish'}
      description={
        daily
          ? `“${ration.name}”: tasdiqlasangiz, bir kunlik yem ombordan chiqariladi va ratsion bugun “berildi” deb belgilanadi.`
          : 'Haqiqatan berilgan yem ombordan chiqariladi. Saqlangan yozuvni o‘chirib bo‘lmaydi — xato bo‘lsa, inventarizatsiya bilan tuzatiladi.'
      }
      dismissible={!issue.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={issue.isPending}>
            Bekor qilish
          </Button>
          <Button onClick={submit} loading={issue.isPending} disabled={!dayCount || anyShort}>
            {daily ? 'Ha, berildi' : 'Ombordan chiqarish'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {daily ? null : (
          <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-end">
            <Field label="Necha kunlik sarf" error={days.trim() ? (problem ?? undefined) : undefined} required>
              <Input inputMode="numeric" autoComplete="off" value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={days === preset ? 'primary' : 'secondary'}
                  aria-pressed={days === preset}
                  onClick={() => setDays(preset)}
                >
                  {preset} kun
                </Button>
              ))}
            </div>
          </div>
        )}

        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Ombordan chiqariladigan yemlar</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-secondary">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Yem
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Chiqariladi
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Omborda
              </th>
              <th scope="col" className="py-2 font-semibold">
                Holat
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ line, required, available, short }) => (
              <tr key={line.inventoryItemId} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-2 pr-3 font-medium text-ink">
                  {line.item.name}
                </th>
                <td className="py-2 pr-3 text-right tabular">
                  {required ? formatQuantity(required.toString(), line.item.unit) : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular">{formatQuantity(available.toString(), line.item.unit)}</td>
                <td className="py-2">{short ? <Badge tone="danger">Yetmaydi</Badge> : <Badge tone="success">Yetarli</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {anyShort ? (
          <Alert tone="warning" title="Omborda yetarli yem yo‘q">
            Kunlar sonini kamaytiring yoki avval omborga kirim qiling — sarf qisman chiqarilmaydi.
          </Alert>
        ) : null}
        {serverShort.length > 0 ? (
          <Alert tone="danger" title="Ombordagi qoldiq o‘zgargan">
            <ul className="mt-1 flex flex-col gap-0.5">
              {serverShort.map((item) => (
                <li key={item.inventoryItemId}>
                  {item.name}: kerak {formatQuantity(item.required, unitOf(item.inventoryItemId))}, bor{' '}
                  {formatQuantity(item.available, unitOf(item.inventoryItemId))}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <FormError message={issue.error ? errorMessage(issue.error) : null} />
        )}
      </div>
    </Modal>
  );
}
