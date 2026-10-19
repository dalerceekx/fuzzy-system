import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Send } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { normalizeUzPhone } from '@/shared/lib/phone';
import { newPasswordSchema, otpCodeSchema, phoneSchema } from '@/shared/lib/validation';
import { Button, Field, FormError, Input, PasswordInput } from '@/shared/ui';
import { authApi } from '../api/auth.api';
import { useSessionStore } from '../model/session.store';
import { useOtpVerification } from '../model/useOtpVerification';
import { OtpCodeField } from './OtpCodeField';
import type { VerificationState } from './RegisterForm';
import { ResendCode } from './ResendCode';

const forgotSchema = z.object({ phone: phoneSchema });
type ForgotValues = z.infer<typeof forgotSchema>;

export function ForgotPasswordForm() {
  const navigate = useNavigate();
  const forgot = useMutation({ mutationFn: authApi.forgotPassword });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema), defaultValues: { phone: '' } });

  const submit = handleSubmit(({ phone }) => {
    if (forgot.isPending) return;
    const normalized = normalizeUzPhone(phone) ?? phone;
    forgot.mutate(normalized, {
      onSuccess: (response) => {
        const state: VerificationState = {
          ...response,
          phone: normalized,
          receivedAt: Date.now(),
        };
        navigate('/forgot-password/reset', { state });
      },
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Telefon raqami" error={errors.phone?.message} required>
        <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" {...register('phone')} />
      </Field>
      <FormError message={forgot.error ? errorMessage(forgot.error) : null} />
      <Button type="submit" size="lg" fullWidth loading={forgot.isPending} icon={<Send aria-hidden className="size-5" />}>
        Kod yuborish
      </Button>
    </form>
  );
}

const resetSchema = z
  .object({
    code: otpCodeSchema,
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Parolni takrorlang'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parollar mos emas',
  });
type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordForm({ verification }: { verification: VerificationState }) {
  const navigate = useNavigate();
  const setNotice = useSessionStore((state) => state.setNotice);
  const challenge = useOtpVerification(verification);
  const reset = useMutation({ mutationFn: authApi.resetPassword });
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', newPassword: '', confirmPassword: '' },
  });

  const submit = handleSubmit(({ code, newPassword }) => {
    if (reset.isPending || challenge.resend.isPending || challenge.expiresIn === 0) return;
    reset.mutate(
      { verificationId: challenge.verificationId, code, newPassword },
      {
        onSuccess: () => {
          setNotice('password-reset');
          navigate('/login', { replace: true, state: { phone: verification.phone } });
        },
      },
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <OtpCodeField
          label="SMS kodi"
          autoFocus
          disabled={reset.isPending || challenge.resend.isPending || challenge.expiresIn === 0}
          error={errors.code?.message}
          {...register('code')}
        />
        {challenge.expiresIn === 0 ? (
          <p role="alert" className="text-sm text-danger">
            Kod muddati tugadi. Yangi kod so‘rang.
          </p>
        ) : null}
        <Field label="Yangi parol" error={errors.newPassword?.message} required hint="Kamida 8 ta belgi, harf va raqam bo‘lsin">
          <PasswordInput autoComplete="new-password" {...register('newPassword')} />
        </Field>
        <Field label="Yangi parolni takrorlang" error={errors.confirmPassword?.message} required>
          <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
        </Field>
        <FormError message={reset.error ? errorMessage(reset.error) : null} />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={reset.isPending}
          disabled={challenge.resend.isPending || challenge.expiresIn === 0}
          icon={<KeyRound aria-hidden className="size-5" />}
        >
          Parolni yangilash
        </Button>
      </form>
      <ResendCode
        challenge={challenge}
        disabled={reset.isPending}
        onResent={() => {
          resetField('code');
          reset.reset();
        }}
      />
    </div>
  );
}
