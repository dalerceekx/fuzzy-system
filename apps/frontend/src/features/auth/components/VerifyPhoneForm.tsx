import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { otpCodeSchema } from '@/shared/lib/validation';
import { Button, FormError } from '@/shared/ui';
import { authApi } from '../api/auth.api';
import { useSessionStore } from '../model/session.store';
import { useOtpVerification } from '../model/useOtpVerification';
import { OtpCodeField } from './OtpCodeField';
import type { VerificationState } from './RegisterForm';
import { ResendCode } from './ResendCode';

const schema = z.object({ code: otpCodeSchema });
type Values = z.infer<typeof schema>;

export function VerifyPhoneForm({ verification }: { verification: VerificationState }) {
  const navigate = useNavigate();
  const setNotice = useSessionStore((state) => state.setNotice);
  const challenge = useOtpVerification(verification);
  const verify = useMutation({ mutationFn: authApi.verifyPhone });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  const submit = handleSubmit(({ code }) => {
    if (verify.isPending || challenge.resend.isPending || challenge.expiresIn === 0) return;
    verify.mutate(
      { verificationId: challenge.verificationId, code },
      {
        onSuccess: () => {
          setNotice('phone-verified');
          navigate('/login', { replace: true, state: { phone: verification.phone } });
        },
      },
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <OtpCodeField
          autoFocus
          disabled={verify.isPending || challenge.resend.isPending || challenge.expiresIn === 0}
          error={errors.code?.message}
          {...register('code')}
        />
        {challenge.expiresIn === 0 ? (
          <p role="alert" className="text-sm text-danger">
            Kod muddati tugadi. Yangi kod so‘rang.
          </p>
        ) : (
          <p className="text-center text-sm text-ink-secondary">
            Kod {Math.floor(challenge.expiresIn / 60)}:{String(challenge.expiresIn % 60).padStart(2, '0')} davomida amal qiladi.
          </p>
        )}
        <FormError message={verify.error ? errorMessage(verify.error) : null} />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={verify.isPending}
          disabled={challenge.resend.isPending || challenge.expiresIn === 0}
          icon={<CheckCircle2 aria-hidden className="size-5" />}
        >
          Tasdiqlash
        </Button>
      </form>
      <ResendCode
        challenge={challenge}
        disabled={verify.isPending}
        onResent={() => {
          reset({ code: '' });
          verify.reset();
        }}
      />
    </div>
  );
}
