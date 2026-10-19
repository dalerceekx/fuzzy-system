import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage, toApiError, validationFieldErrors } from '@/shared/api/errors';
import { todayInTashkent } from '@/shared/lib/dates';
import { Button, Field, FormError, Input, Modal, Select, Textarea, toast } from '@/shared/ui';
import { ANIMAL_SEXES, SPECIES, type Animal } from '../api/animals.api';
import { SEX_LABELS, SPECIES_LABELS } from '../lib/labels';
import {
  ANIMAL_FORM_FIELDS,
  animalFormSchema,
  animalToForm,
  clearedFields,
  emptyAnimalForm,
  toCreateInput,
  toUpdateInput,
  type AnimalFormInput,
  type AnimalFormValues,
} from '../model/animal-form';
import { useCreateAnimal, useUpdateAnimal } from '../model/animals.queries';

interface AnimalFormDialogProps {
  open: boolean;
  onClose: () => void;
  farmId: string;
  farmName: string;
  /** Edit mode when provided. */
  animal?: Animal | null;
}

export function AnimalFormDialog({ open, onClose, farmId, farmName, animal }: AnimalFormDialogProps) {
  const create = useCreateAnimal();
  const update = useUpdateAnimal();
  const mutation = animal ? update : create;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<AnimalFormInput, unknown, AnimalFormValues>({
    resolver: zodResolver(animalFormSchema),
    defaultValues: emptyAnimalForm(),
  });

  useEffect(() => {
    if (!open) return;
    reset(animal ? animalToForm(animal) : emptyAnimalForm());
    create.reset();
    update.reset();
    // Reset only when the dialog opens or the edited animal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, animal]);

  function applyServerErrors(error: unknown): void {
    if (toApiError(error).code === 'TAG_NUMBER_TAKEN') {
      setError('tagNumber', { message: 'Bu birka raqami fermada allaqachon bor' });
      return;
    }
    const fieldErrors = validationFieldErrors(error, ANIMAL_FORM_FIELDS);
    for (const [field, message] of Object.entries(fieldErrors)) {
      setError(field as keyof AnimalFormInput, { message });
    }
  }

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;
    if (animal) {
      const cleared = clearedFields(animal, values);
      if (cleared.length > 0) {
        for (const field of cleared) {
          setError(field, { message: 'Avval kiritilgan qiymatni o‘chirib bo‘lmaydi — yangi qiymat kiriting' });
        }
        return;
      }
      const body = toUpdateInput(animal, values);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      update.mutate(
        { id: animal.id, body },
        {
          onSuccess: () => {
            toast.success('Hayvon ma’lumotlari saqlandi');
            onClose();
          },
          onError: applyServerErrors,
        },
      );
    } else {
      create.mutate(toCreateInput(farmId, values), {
        onSuccess: (created) => {
          toast.success(`${created.tagNumber} raqamli hayvon qo‘shildi`);
          onClose();
        },
        onError: applyServerErrors,
      });
    }
  });

  const serverError =
    mutation.error && toApiError(mutation.error).code !== 'TAG_NUMBER_TAKEN' ? errorMessage(mutation.error) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={animal ? 'Hayvonni tahrirlash' : 'Hayvon qo‘shish'}
      description={`Ferma: ${farmName}`}
      size="lg"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="animal-form" loading={mutation.isPending}>
            Saqlash
          </Button>
        </>
      }
    >
      <form id="animal-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Hayvon turi" error={errors.species?.message} required>
          <Select data-autofocus {...register('species')}>
            {SPECIES.map((species) => (
              <option key={species} value={species}>
                {SPECIES_LABELS[species]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jinsi" error={errors.sex?.message}>
          <Select {...register('sex')}>
            {ANIMAL_SEXES.map((sex) => (
              <option key={sex} value={sex}>
                {SEX_LABELS[sex]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Birka raqami" error={errors.tagNumber?.message} required hint="Quloqdagi birka yoki ichki raqam">
          <Input autoComplete="off" placeholder="Masalan: UZ-015" {...register('tagNumber')} />
        </Field>
        <Field label="Laqabi" error={errors.name?.message} hint="Ixtiyoriy">
          <Input autoComplete="off" placeholder="Masalan: Oqqiz" {...register('name')} />
        </Field>
        <Field label="Tug‘ilgan sana" error={errors.birthDate?.message} hint="Ixtiyoriy">
          <Input type="date" max={todayInTashkent()} {...register('birthDate')} />
        </Field>
        <Field label="Vazni (kg)" error={errors.weightKg?.message} hint="Ixtiyoriy, masalan 450,5">
          <Input inputMode="decimal" autoComplete="off" placeholder="0" {...register('weightKg')} />
        </Field>
        <Field label="Izoh" error={errors.notes?.message} hint="Ixtiyoriy" className="sm:col-span-2">
          <Textarea rows={3} placeholder="Qo‘shimcha ma’lumot" {...register('notes')} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={serverError} />
        </div>
      </form>
    </Modal>
  );
}
