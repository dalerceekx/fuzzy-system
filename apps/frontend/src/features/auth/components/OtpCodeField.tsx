import type { ComponentProps } from 'react';
import { Field, Input } from '@/shared/ui';

interface OtpCodeFieldProps extends Omit<ComponentProps<'input'>, 'type'> {
  label?: string;
  error?: string | undefined;
  hint?: string;
}

/** 6-digit code input (SMS or authenticator app). */
export function OtpCodeField({ label = 'Tasdiqlash kodi', error, hint, ...props }: OtpCodeFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        pattern="[0-9]{6}"
        placeholder="••••••"
        className="text-center text-xl tracking-[0.4em] tabular"
        {...props}
      />
    </Field>
  );
}
