import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { otpCodeSchema } from '@/shared/lib/validation';
import { Button, FormError } from '@/shared/ui';
import { useMfaVerify } from '../hooks/useAuthFlows';
import type { MfaChallenge } from '../model/session.store';
import { OtpCodeField } from './OtpCodeField';

const schema = z.object({ code: otpCodeSchema });
type Values = z.infer<typeof schema>;

export function MfaVerifyForm({ challenge }: { challenge: MfaChallenge }) {
  const verify = useMfaVerify();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  const submit = handleSubmit(({ code }) => {
    if (verify.isPending) return;
    verify.mutate({ mfaToken: challenge.mfaToken, code });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <OtpCodeField
        autoFocus
        error={errors.code?.message}
        hint="Authenticator ilovasidagi (Google Authenticator, Microsoft Authenticator, Authy) 6 xonali kod"
        {...register('code')}
      />
      <FormError message={verify.error ? errorMessage(verify.error) : null} />
      <Button type="submit" size="lg" fullWidth loading={verify.isPending} icon={<ShieldCheck aria-hidden className="size-5" />}>
        Tasdiqlash
      </Button>
    </form>
  );
}
