import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { authApi } from '@/features/auth/api/auth.api';
import { authKeys } from '@/features/auth/model/keys';
import { errorMessage, toApiError } from '@/shared/api/errors';
import { newPasswordSchema } from '@/shared/lib/validation';
import { Alert, Button, Field, FormError, PasswordInput, toast } from '@/shared/ui';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Joriy parolni kiriting').max(128),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Yangi parolni takrorlang'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parollar mos emas',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'Yangi parol joriy paroldan farq qilsin',
  });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const queryClient = useQueryClient();
  const change = useMutation({ mutationFn: authApi.changePassword });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const submit = handleSubmit(({ currentPassword, newPassword }) => {
    if (change.isPending) return;
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          reset();
          toast.success('Parol almashtirildi');
          // The server signed out every other session.
          void queryClient.invalidateQueries({ queryKey: authKeys.sessions });
        },
        onError: (error) => {
          if (toApiError(error).code === 'INVALID_CREDENTIALS') {
            setError('currentPassword', { message: 'Joriy parol noto‘g‘ri' });
          }
        },
      },
    );
  });

  const showGeneralError = change.error && toApiError(change.error).code !== 'INVALID_CREDENTIALS';

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      {change.isSuccess ? (
        <Alert tone="success" title="Parol yangilandi">
          Xavfsizlik uchun boshqa barcha qurilmalardagi sessiyalar yopildi. Bu qurilmada ishlashda davom etishingiz mumkin.
        </Alert>
      ) : null}
      <Field label="Joriy parol" error={errors.currentPassword?.message} required>
        <PasswordInput autoComplete="current-password" {...register('currentPassword')} />
      </Field>
      <Field label="Yangi parol" error={errors.newPassword?.message} required hint="Kamida 8 ta belgi, harf va raqam bo‘lsin">
        <PasswordInput autoComplete="new-password" {...register('newPassword')} />
      </Field>
      <Field label="Yangi parolni takrorlang" error={errors.confirmPassword?.message} required>
        <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
      </Field>
      <FormError message={showGeneralError ? errorMessage(change.error) : null} />
      <div>
        <Button type="submit" loading={change.isPending} icon={<KeyRound aria-hidden className="size-5" />}>
          Parolni almashtirish
        </Button>
      </div>
    </form>
  );
}
