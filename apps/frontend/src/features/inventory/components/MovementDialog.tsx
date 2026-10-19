import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage, toApiError, validationFieldErrors } from '@/shared/api/errors';
import { Decimal } from '@/shared/lib/decimal';
import { formatMoney } from '@/shared/lib/format';
import { newIdempotencyKey } from '@/shared/lib/idempotency';
import { decimalProblem, decimalString, normalizeDecimal } from '@/shared/lib/validation';
import { Alert, Button, Field, FormError, Input, Modal, Select, Textarea, toast } from '@/shared/ui';
import type { CreateMovementInput, InventoryItem, MovementType } from '../api/inventory.api';
import { formatQuantity, UNIT_SHORT } from '../lib/labels';
import { useCreateMovement } from '../model/inventory.queries';

export type MovementIntent = 'purchase' | 'intake' | 'consumption' | 'adjustment';

const INTENTS: Record<MovementIntent, { title: string; description: string; submit: string; success: string }> = {
  purchase: {
    title: 'Xarid qilish',
    description: 'Sotib olingan mahsulotni narxi bilan omborga kiriting.',
    submit: 'Xaridni saqlash',
    success: 'Xarid omborga kiritildi',
  },
  intake: {
    title: 'Kirim (xaridsiz)',
    description: 'Masalan, o‘z hosilingiz yoki boshqa joydan kelgan mahsulot.',
    submit: 'Kirimni saqlash',
    success: 'Kirim saqlandi',
  },
  consumption: {
    title: 'Sarflash',
    description: 'Ishlatilgan miqdorni ombordan chiqaring.',
    submit: 'Chiqimni saqlash',
    success: 'Chiqim saqlandi',
  },
  adjustment: {
    title: 'Inventarizatsiya tuzatishi',
    description: 'Hisobdagi qoldiqni sanab chiqilgan haqiqiy qoldiqqa moslang.',
    submit: 'Tuzatishni saqlash',
    success: 'Tuzatish saqlandi',
  },
};

const quantitySchema = decimalString({ maxIntegerDigits: 11, maxFractionDigits: 3, positive: true });
const UNIT_COST_RULE = { maxIntegerDigits: 14, maxFractionDigits: 2 };

function schemaFor(intent: MovementIntent) {
  return z
    .object({
      quantity: quantitySchema,
      unitCost: z.string().trim(),
      direction: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT']),
      reason: z.string().trim().max(500, 'Ko‘pi bilan 500 ta belgi'),
    })
    .superRefine((values, context) => {
      if (intent === 'purchase') {
        const problem = values.unitCost ? decimalProblem(values.unitCost, UNIT_COST_RULE) : 'Narxni kiriting';
        if (problem) context.addIssue({ code: 'custom', path: ['unitCost'], message: problem });
      }
      if (intent === 'adjustment' && !values.reason) {
        context.addIssue({ code: 'custom', path: ['reason'], message: 'Tuzatish sababini yozing' });
      }
    });
}

type FormInput = z.input<ReturnType<typeof schemaFor>>;
type FormOutput = z.output<ReturnType<typeof schemaFor>>;

function movementType(intent: MovementIntent, direction: FormOutput['direction']): MovementType {
  if (intent === 'consumption') return 'OUT';
  if (intent === 'adjustment') return direction;
  return 'IN';
}

interface MovementDialogProps {
  item: InventoryItem | null;
  intent: MovementIntent;
  onClose: () => void;
  /** Optional preset, e.g. from the feed calculator. */
  defaultQuantity?: string;
  defaultReason?: string;
}

/**
 * Records one stock movement. The server computes the new balance and
 * rejects overdrafts (409 INSUFFICIENT_STOCK); the preview here is only an
 * estimate. One Idempotency-Key per dialog session makes retries safe.
 */
export function MovementDialog({ item, intent, onClose, defaultQuantity = '', defaultReason = '' }: MovementDialogProps) {
  const createMovement = useCreateMovement();
  const idempotencyKey = useRef<string>(newIdempotencyKey());
  const meta = INTENTS[intent];
  const resolver = useMemo(() => zodResolver(schemaFor(intent)), [intent]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver,
    defaultValues: { quantity: defaultQuantity, unitCost: '', direction: 'ADJUSTMENT_OUT', reason: defaultReason },
  });

  useEffect(() => {
    if (!item) return;
    idempotencyKey.current = newIdempotencyKey();
    // A purchase starts from the item's current price (editable).
    const unitCost = intent === 'purchase' && item.unitPrice ? Decimal.from(item.unitPrice).toString() : '';
    reset({ quantity: defaultQuantity, unitCost, direction: 'ADJUSTMENT_OUT', reason: defaultReason });
    createMovement.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, intent]);

  const [quantityValue, unitCostValue, direction] = useWatch({ control, name: ['quantity', 'unitCost', 'direction'] });

  if (!item) return null;

  const unit = UNIT_SHORT[item.unit];
  const current = Decimal.parse(item.quantity) ?? Decimal.ZERO;
  const quantity = Decimal.parse(quantityValue ?? '');
  const type = movementType(intent, direction ?? 'ADJUSTMENT_OUT');
  const outgoing = type === 'OUT' || type === 'ADJUSTMENT_OUT';
  const projected = quantity ? (outgoing ? current.sub(quantity) : current.add(quantity)) : null;
  const unitCost = Decimal.parse(unitCostValue ?? '');
  const total = intent === 'purchase' && quantity && unitCost ? quantity.mul(unitCost) : null;

  const submit = handleSubmit((values) => {
    if (createMovement.isPending) return;
    const amount = Decimal.from(values.quantity);
    if (outgoing && amount.gt(current)) {
      setError('quantity', { message: `Omborda faqat ${formatQuantity(item.quantity, item.unit)} bor` });
      return;
    }
    const body: CreateMovementInput = {
      type,
      quantity: values.quantity,
      ...(intent === 'purchase' ? { unitCost: normalizeDecimal(values.unitCost), currency: 'UZS' } : {}),
      ...(values.reason ? { reason: values.reason } : {}),
    };
    createMovement.mutate(
      { itemId: item.id, body, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (movement) => {
          toast.success(`${meta.success}: ${formatQuantity(movement.quantity, item.unit)}`);
          onClose();
        },
        onError: (error) => {
          const apiError = toApiError(error);
          if (apiError.code === 'INSUFFICIENT_STOCK') {
            const available = typeof apiError.details?.available === 'string' ? apiError.details.available : item.quantity;
            setError('quantity', { message: `Omborda yetarli emas: ${formatQuantity(available, item.unit)} bor` });
            return;
          }
          const fieldErrors = validationFieldErrors(error, ['quantity', 'unitCost', 'reason'] as const);
          for (const [field, message] of Object.entries(fieldErrors)) {
            setError(field as 'quantity' | 'unitCost' | 'reason', { message });
          }
        },
      },
    );
  });

  const serverError =
    createMovement.error && toApiError(createMovement.error).code !== 'INSUFFICIENT_STOCK'
      ? errorMessage(createMovement.error)
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${meta.title}: ${item.name}`}
      description={meta.description}
      dismissible={!createMovement.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={createMovement.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="movement-form" loading={createMovement.isPending}>
            {meta.submit}
          </Button>
        </>
      }
    >
      <form id="movement-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="rounded-[10px] bg-background px-3 py-2.5 text-sm">
          Hozirgi qoldiq: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
        </p>

        {intent === 'adjustment' ? (
          <Field label="Tuzatish yo‘nalishi" required>
            <Select {...register('direction')}>
              <option value="ADJUSTMENT_OUT">Kamaytirish (yo‘qolgan, buzilgan)</option>
              <option value="ADJUSTMENT_IN">Ko‘paytirish (hisobga olinmagan)</option>
            </Select>
          </Field>
        ) : null}

        <Field label={`Miqdor (${unit})`} error={errors.quantity?.message} required>
          <Input data-autofocus inputMode="decimal" autoComplete="off" placeholder="0" {...register('quantity')} />
        </Field>

        {intent === 'purchase' ? (
          <Field label={`1 ${unit} narxi (so‘m)`} error={errors.unitCost?.message} required>
            <Input inputMode="decimal" autoComplete="off" placeholder="0" {...register('unitCost')} />
          </Field>
        ) : null}

        <Field
          label={intent === 'adjustment' ? 'Sabab' : 'Izoh'}
          error={errors.reason?.message}
          required={intent === 'adjustment'}
          hint={intent === 'adjustment' ? undefined : 'Ixtiyoriy'}
        >
          <Textarea rows={2} maxLength={500} {...register('reason')} />
        </Field>

        {total ? (
          <p className="text-sm text-ink-secondary">
            Jami summa: <strong className="text-ink tabular">{formatMoney(total)}</strong>
          </p>
        ) : null}
        {projected ? (
          projected.isNegative() ? (
            <Alert tone="danger">Bu miqdor ombordagi qoldiqdan ko‘p.</Alert>
          ) : (
            <p className="text-sm text-ink-secondary">
              Saqlangandan keyingi qoldiq (taxminiy):{' '}
              <strong className="text-ink tabular">{formatQuantity(projected.toString(), item.unit)}</strong>
            </p>
          )
        ) : null}
        <FormError message={serverError} />
      </form>
    </Modal>
  );
}
