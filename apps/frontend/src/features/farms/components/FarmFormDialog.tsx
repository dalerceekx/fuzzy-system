import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { optionalText, requiredText } from '@/shared/lib/validation';
import { Button, Field, FormError, Input, Modal, toast } from '@/shared/ui';
import type { Farm } from '../api/farms.api';
import { useCreateFarm, useUpdateFarm } from '../model/active-farm';

const schema = z.object({
  name: requiredText('Ferma nomini kiriting', 100),
  region: optionalText(100),
});
type Values = z.infer<typeof schema>;

interface FarmFormDialogProps {
  open: boolean;
  onClose: () => void;
  farm?: Farm | null;
}

export function FarmFormDialog({ open, onClose, farm }: FarmFormDialogProps) {
  const createFarm = useCreateFarm();
  const updateFarm = useUpdateFarm();
  const mutation = farm ? updateFarm : createFarm;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', region: '' } });

  useEffect(() => {
    if (open) {
      reset({ name: farm?.name ?? '', region: farm?.region ?? '' });
      createFarm.reset();
      updateFarm.reset();
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, farm]);

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;
    const body = { name: values.name, ...(values.region ? { region: values.region } : {}) };
    const onSuccess = () => {
      toast.success(farm ? 'Ferma ma’lumotlari saqlandi' : 'Ferma qo‘shildi');
      onClose();
    };
    if (farm) updateFarm.mutate({ id: farm.id, body }, { onSuccess });
    else createFarm.mutate(body, { onSuccess });
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={farm ? 'Fermani tahrirlash' : 'Yangi ferma'}
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="farm-form" loading={mutation.isPending}>
            Saqlash
          </Button>
        </>
      }
    >
      <form id="farm-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Ferma nomi" error={errors.name?.message} required>
          <Input data-autofocus placeholder="Masalan: Tog‘ etagidagi ferma" {...register('name')} />
        </Field>
        <Field label="Hudud" error={errors.region?.message} hint="Ixtiyoriy: viloyat yoki tuman">
          <Input placeholder="Masalan: Samarqand viloyati" {...register('region')} />
        </Field>
        <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
      </form>
    </Modal>
  );
}
