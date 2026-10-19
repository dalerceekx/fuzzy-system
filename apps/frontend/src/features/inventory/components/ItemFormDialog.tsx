import { zodResolver } from '@hookform/resolvers/zod';
import { Scale } from 'lucide-react';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMedicineCatalog } from '@/features/medicines/model/medicines.queries';
import { errorMessage, validationFieldErrors } from '@/shared/api/errors';
import { isValidIsoDate } from '@/shared/lib/dates';
import { Decimal } from '@/shared/lib/decimal';
import { decimalProblem, normalizeDecimal, optionalText, requiredText, type DecimalRule } from '@/shared/lib/validation';
import { Button, Field, FormError, Input, Modal, Select, toast } from '@/shared/ui';
import { INVENTORY_UNITS, type InventoryCategory, type InventoryItem, type InventoryUnit } from '../api/inventory.api';
import { CATEGORY_LABELS, formatQuantity, UNIT_NAMES, UNIT_SHORT } from '../lib/labels';
import { useCreateItem, useUpdateItem } from '../model/inventory.queries';

/** Backend limit for useWithinDaysAfterOpening. */
const MAX_OPEN_DAYS = 3650;
/** Backend limits: unitPrice Decimal(16,2); minQuantity / initialQuantity Decimal(14,3). */
const PRICE_RULE: DecimalRule = { maxIntegerDigits: 14, maxFractionDigits: 2 };
const QUANTITY_RULE: DecimalRule = { maxIntegerDigits: 11, maxFractionDigits: 3 };

/** Optional decimal typed by a person ("1 234,5"); empty means "not given". */
function optionalDecimalInput(rule: DecimalRule) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      const problem = value ? decimalProblem(value, rule) : null;
      if (problem) context.addIssue({ code: 'custom', message: problem });
    });
}

const schema = z.object({
  name: requiredText('Mahsulot nomini kiriting', 120),
  unit: z.enum(INVENTORY_UNITS),
  medicineId: z.string(),
  batchNumber: optionalText(64),
  expiresOn: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidIsoDate(value), 'Sana noto‘g‘ri'),
  useWithinDaysAfterOpening: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_OPEN_DAYS),
      `1 dan ${MAX_OPEN_DAYS} gacha kun kiriting`,
    ),
  initialQuantity: optionalDecimalInput({ ...QUANTITY_RULE, positive: true }),
  unitPrice: optionalDecimalInput(PRICE_RULE),
  minQuantity: optionalDecimalInput(QUANTITY_RULE),
});
type Values = z.infer<typeof schema>;

const DEFAULT_UNIT: Record<InventoryCategory, InventoryUnit> = { FEED: 'KG', MEDICINE: 'ML', EQUIPMENT: 'PIECE', OTHER: 'PIECE' };

/** "3400.00" → "3400" for the input; empty when not set. */
const inputValue = (value: string | null | undefined) => (value ? Decimal.from(value).toString() : '');

interface ItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  farmId: string;
  category: InventoryCategory;
  /** Edit mode (metadata only — quantity changes only through movements). */
  item?: InventoryItem | null;
  /** Edit mode: offers "Miqdorni tuzatish" (an inventory adjustment movement). */
  onAdjustQuantity?: () => void;
}

export function ItemFormDialog({ open, onClose, farmId, category, item, onAdjustQuantity }: ItemFormDialogProps) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const mutation = item ? update : create;
  const isMedicine = category === 'MEDICINE';
  const medicines = useMedicineCatalog(open && isMedicine && !item);
  const approved = (medicines.data ?? []).filter((medicine) => medicine.status === 'APPROVED');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      unit: DEFAULT_UNIT[category],
      medicineId: '',
      batchNumber: '',
      expiresOn: '',
      useWithinDaysAfterOpening: '',
      initialQuantity: '',
      unitPrice: '',
      minQuantity: '',
    },
  });
  const unit = UNIT_SHORT[useWatch({ control, name: 'unit' }) ?? DEFAULT_UNIT[category]];

  useEffect(() => {
    if (!open) return;
    reset({
      name: item?.name ?? '',
      unit: item?.unit ?? DEFAULT_UNIT[category],
      medicineId: item?.medicineId ?? '',
      batchNumber: item?.batchNumber ?? '',
      expiresOn: item?.expiresOn ?? '',
      useWithinDaysAfterOpening: item?.useWithinDaysAfterOpening ? String(item.useWithinDaysAfterOpening) : '',
      initialQuantity: '',
      unitPrice: inputValue(item?.unitPrice),
      minQuantity: inputValue(item?.minQuantity),
    });
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;
    const optional = {
      ...(values.batchNumber ? { batchNumber: values.batchNumber } : {}),
      ...(values.expiresOn ? { expiresOn: values.expiresOn } : {}),
      ...(values.useWithinDaysAfterOpening ? { useWithinDaysAfterOpening: Number(values.useWithinDaysAfterOpening) } : {}),
      ...(values.unitPrice ? { unitPrice: normalizeDecimal(values.unitPrice) } : {}),
      ...(values.minQuantity ? { minQuantity: normalizeDecimal(values.minQuantity) } : {}),
    };
    const onError = (error: unknown) => {
      const fieldErrors = validationFieldErrors(error, [
        'name',
        'unit',
        'medicineId',
        'batchNumber',
        'expiresOn',
        'useWithinDaysAfterOpening',
        'initialQuantity',
        'unitPrice',
        'minQuantity',
      ] as const);
      for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof Values, { message });
    };
    if (item) {
      // Emptied fields are cleared with null (supported by the PATCH DTO).
      const body = {
        name: values.name,
        batchNumber: values.batchNumber || (item.batchNumber ? null : undefined),
        expiresOn: values.expiresOn || (item.expiresOn ? null : undefined),
        useWithinDaysAfterOpening: values.useWithinDaysAfterOpening
          ? Number(values.useWithinDaysAfterOpening)
          : item.useWithinDaysAfterOpening
            ? null
            : undefined,
        unitPrice: values.unitPrice ? normalizeDecimal(values.unitPrice) : item.unitPrice ? null : undefined,
        minQuantity: values.minQuantity ? normalizeDecimal(values.minQuantity) : item.minQuantity ? null : undefined,
      };
      update.mutate(
        { id: item.id, body: Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) },
        {
          onSuccess: () => {
            toast.success('Mahsulot ma’lumotlari saqlandi');
            onClose();
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      {
        farmId,
        category,
        name: values.name,
        unit: values.unit,
        ...(isMedicine && values.medicineId ? { medicineId: values.medicineId } : {}),
        ...optional,
        ...(values.initialQuantity ? { initialQuantity: normalizeDecimal(values.initialQuantity) } : {}),
      },
      {
        onSuccess: (created) => {
          toast.success(`“${created.name}” omborga qo‘shildi`);
          onClose();
        },
        onError,
      },
    );
  });

  const label = CATEGORY_LABELS[category].toLowerCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `${item.name}: tahrirlash` : `Yangi ${label}`}
      description={
        item
          ? 'Miqdor faqat kirim, sarf yoki inventarizatsiya orqali o‘zgaradi.'
          : 'Boshlang‘ich miqdorni kiritsangiz, u narxi bilan omborga kirim sifatida yoziladi.'
      }
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="item-form" loading={mutation.isPending}>
            Saqlash
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nomi" error={errors.name?.message} required className="sm:col-span-2">
          <Input
            data-autofocus
            autoComplete="off"
            placeholder={isMedicine ? 'Masalan: dori nomi va hajmi' : 'Masalan: Arpa'}
            {...register('name')}
          />
        </Field>
        <Field
          label="O‘lchov birligi"
          error={errors.unit?.message}
          required
          hint={item ? 'Yaratilgandan keyin o‘zgartirib bo‘lmaydi' : undefined}
        >
          <Select disabled={Boolean(item)} {...register('unit')}>
            {INVENTORY_UNITS.map((value) => (
              <option key={value} value={value}>
                {UNIT_NAMES[value]}
              </option>
            ))}
          </Select>
        </Field>
        {item ? null : (
          <Field
            label={`Boshlang‘ich miqdor (${unit})`}
            error={errors.initialQuantity?.message}
            hint="Ixtiyoriy: hozir omborda bor miqdor"
          >
            <Input inputMode="decimal" autoComplete="off" placeholder="Masalan: 500" {...register('initialQuantity')} />
          </Field>
        )}
        <Field
          label={`1 ${unit} narxi (so‘m)`}
          error={errors.unitPrice?.message}
          hint="Ixtiyoriy: har bir narxli xarid uni yangilaydi"
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="Masalan: 3500" {...register('unitPrice')} />
        </Field>
        <Field
          label={`Minimal qoldiq (${unit})`}
          error={errors.minQuantity?.message}
          hint="Ixtiyoriy: shundan kam qolsa ogohlantiradi"
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="Masalan: 100" {...register('minQuantity')} />
        </Field>
        {item && onAdjustQuantity ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-background px-3 py-2.5 sm:col-span-2">
            <p className="text-sm">
              Hozirgi miqdor: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<Scale aria-hidden className="size-4" />}
              onClick={() => {
                onClose();
                onAdjustQuantity();
              }}
            >
              Miqdorni tuzatish
            </Button>
          </div>
        ) : null}
        {isMedicine && !item ? (
          <Field label="Katalogdagi dori" error={errors.medicineId?.message} hint="Faqat tasdiqlangan dorilar">
            <Select {...register('medicineId')} disabled={medicines.isPending}>
              <option value="">Bog‘lanmagan</option>
              {approved.map((medicine) => (
                <option key={medicine.id} value={medicine.id}>
                  {medicine.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {isMedicine ? (
          <>
            <Field label="Partiya raqami" error={errors.batchNumber?.message} hint="Ixtiyoriy">
              <Input autoComplete="off" {...register('batchNumber')} />
            </Field>
            <Field label="Yaroqlilik muddati" error={errors.expiresOn?.message} hint="Ixtiyoriy">
              <Input type="date" {...register('expiresOn')} />
            </Field>
            <Field
              label="Ochilgandan keyin (kun)"
              error={errors.useWithinDaysAfterOpening?.message}
              hint="Ixtiyoriy: idish ochilgach necha kun ishlatiladi"
            >
              <Input inputMode="numeric" autoComplete="off" {...register('useWithinDaysAfterOpening')} />
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
        </div>
      </form>
    </Modal>
  );
}
