import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage, validationFieldErrors } from '@/shared/api/errors';
import { optionalText, requiredText } from '@/shared/lib/validation';
import { Alert, Button, Field, FormError, Input, Modal, toast } from '@/shared/ui';
import { useCreateMedicine } from '../model/medicines.queries';

const days = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, 'Butun son kiriting (0 yoki ko‘p)')
  .refine((value) => Number(value) <= 3650, '3650 kundan oshmasin');

const schema = z.object({
  name: requiredText('Dori nomini kiriting', 150),
  activeIngredient: requiredText('Ta’sir qiluvchi moddani kiriting', 150),
  form: optionalText(50),
  concentration: optionalText(50),
  withdrawalMeatDays: days,
  withdrawalMilkDays: days,
});
type Values = z.infer<typeof schema>;

/**
 * Creates a DRAFT medicine. Clinical values come from the product label /
 * the veterinarian — the app never suggests them. Only a VET can approve.
 */
export function MedicineFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateMedicine();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      activeIngredient: '',
      form: '',
      concentration: '',
      withdrawalMeatDays: '',
      withdrawalMilkDays: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset();
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = handleSubmit((values) => {
    if (create.isPending) return;
    create.mutate(
      {
        name: values.name,
        activeIngredient: values.activeIngredient,
        ...(values.form ? { form: values.form } : {}),
        ...(values.concentration ? { concentration: values.concentration } : {}),
        withdrawalMeatDays: Number(values.withdrawalMeatDays),
        withdrawalMilkDays: Number(values.withdrawalMilkDays),
      },
      {
        onSuccess: () => {
          toast.success('Dori qoralama sifatida qo‘shildi');
          onClose();
        },
        onError: (error) => {
          const fieldErrors = validationFieldErrors(error, [
            'name',
            'activeIngredient',
            'form',
            'concentration',
            'withdrawalMeatDays',
            'withdrawalMilkDays',
          ] as const);
          for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof Values, { message });
        },
      },
    );
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yangi dori"
      description="Qoralama sifatida saqlanadi; veterinar tasdiqlagach fermerlarga ko‘rinadi."
      size="lg"
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="medicine-form" loading={create.isPending}>
            Saqlash
          </Button>
        </>
      }
    >
      <form id="medicine-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nomi" error={errors.name?.message} required>
          <Input data-autofocus autoComplete="off" {...register('name')} />
        </Field>
        <Field label="Ta’sir qiluvchi modda" error={errors.activeIngredient?.message} required>
          <Input autoComplete="off" {...register('activeIngredient')} />
        </Field>
        <Field label="Shakli" error={errors.form?.message} hint="Ixtiyoriy: eritma, tabletka…">
          <Input autoComplete="off" {...register('form')} />
        </Field>
        <Field label="Konsentratsiya" error={errors.concentration?.message} hint="Ixtiyoriy, yorliqdagidek">
          <Input autoComplete="off" {...register('concentration')} />
        </Field>
        <Field label="Go‘sht uchun kutish muddati (kun)" error={errors.withdrawalMeatDays?.message} required>
          <Input inputMode="numeric" autoComplete="off" {...register('withdrawalMeatDays')} />
        </Field>
        <Field label="Sut uchun kutish muddati (kun)" error={errors.withdrawalMilkDays?.message} required>
          <Input inputMode="numeric" autoComplete="off" {...register('withdrawalMilkDays')} />
        </Field>
        <Alert tone="warning" className="sm:col-span-2">
          Qiymatlarni faqat rasmiy yo‘riqnoma yoki veterinar ma’lumotidan kiriting. Dastur dozalash yoki davolash tavsiya
          qilmaydi.
        </Alert>
        <div className="sm:col-span-2">
          <FormError message={create.error ? errorMessage(create.error) : null} />
        </div>
      </form>
    </Modal>
  );
}
