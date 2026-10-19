import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { errorMessage, validationFieldErrors } from '@/shared/api/errors';
import { normalizeUzPhone } from '@/shared/lib/phone';
import { newPasswordSchema, phoneSchema, requiredText } from '@/shared/lib/validation';
import { Button, Field, FormError, Input, PasswordInput } from '@/shared/ui';
import { authApi } from '../api/auth.api';
import type { VerificationResponse } from '../api/auth.types';

const schema = z
  .object({
    fullName: requiredText('Ism va familiyani kiriting', 100).refine((value) => value.length >= 2, 'Kamida 2 ta belgi'),
    phone: phoneSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Parolni takrorlang'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parollar mos emas',
  })
  .refine((values) => !isPhoneLike(values.password, values.phone), {
    path: ['password'],
    message: 'Parol telefon raqamiga teng bo‘lmasin',
  });

/** Backend rule: the password must not be the phone number itself. */
function isPhoneLike(password: string, phoneInput: string): boolean {
  const phone = normalizeUzPhone(phoneInput);
  if (!phone) return false;
  const international = phone.slice(1);
  return [phone, international, international.slice(3)].includes(password);
}

type Values = z.infer<typeof schema>;

export interface VerificationState extends Omit<VerificationResponse, 'message'> {
  phone: string;
  receivedAt: number;
}

export function RegisterForm({ defaultPhone = '' }: { defaultPhone?: string }) {
  const navigate = useNavigate();
  const registerMutation = useMutation({ mutationFn: authApi.register });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: defaultPhone, password: '', confirmPassword: '' },
  });

  const submit = handleSubmit((values) => {
    if (registerMutation.isPending) return;
    const phone = normalizeUzPhone(values.phone) ?? values.phone;
    registerMutation.mutate(
      { phone, fullName: values.fullName, password: values.password },
      {
        onSuccess: (response) => {
          const state: VerificationState = { ...response, phone, receivedAt: Date.now() };
          navigate('/register/verify', { state });
        },
        onError: (error) => {
          const fieldErrors = validationFieldErrors(error, ['fullName', 'phone', 'password'] as const);
          for (const [field, message] of Object.entries(fieldErrors)) {
            setError(field as keyof Values, { message });
          }
        },
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Ism va familiya" error={errors.fullName?.message} required>
        <Input autoComplete="name" placeholder="Masalan: Alisher Karimov" {...register('fullName')} />
      </Field>
      <Field label="Telefon raqami" error={errors.phone?.message} required hint="Tasdiqlash kodi SMS orqali yuboriladi">
        <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" {...register('phone')} />
      </Field>
      <Field label="Parol" error={errors.password?.message} required hint="Kamida 8 ta belgi, harf va raqam bo‘lsin">
        <PasswordInput autoComplete="new-password" {...register('password')} />
      </Field>
      <Field label="Parolni takrorlang" error={errors.confirmPassword?.message} required>
        <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
      </Field>
      <FormError message={registerMutation.error ? errorMessage(registerMutation.error) : null} />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={registerMutation.isPending}
        icon={<UserPlus aria-hidden className="size-5" />}
      >
        Ro‘yxatdan o‘tish
      </Button>
    </form>
  );
}
