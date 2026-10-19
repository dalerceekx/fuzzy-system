import { errorMessage } from '@/shared/api/errors';
import { Button } from '@/shared/ui';
import type { useOtpVerification } from '../model/useOtpVerification';

/** "Kodni qayta yuborish" with a visible countdown; the server enforces the real cooldown. */
export function ResendCode({
  challenge,
  disabled,
  onResent,
}: {
  challenge: ReturnType<typeof useOtpVerification>;
  disabled: boolean;
  onResent: () => void;
}) {
  const { resendAfter, resend, resendCode } = challenge;

  return (
    <div className="flex flex-col items-center gap-1.5 text-sm">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || resendAfter > 0}
        loading={resend.isPending}
        onClick={() => resendCode(onResent)}
      >
        {resendAfter > 0 ? `Kodni qayta yuborish (${resendAfter})` : 'Kodni qayta yuborish'}
      </Button>
      {resend.isSuccess ? (
        <p role="status" className="text-success">
          So‘rov qabul qilindi. Raqam mos bo‘lsa, yangi kod SMS orqali yuboriladi.
        </p>
      ) : null}
      {resend.isError ? (
        <p role="alert" className="text-danger">
          {errorMessage(resend.error)}
        </p>
      ) : null}
    </div>
  );
}
