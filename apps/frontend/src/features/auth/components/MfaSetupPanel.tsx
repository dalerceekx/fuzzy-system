import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { otpCodeSchema } from '@/shared/lib/validation';
import { Alert, Button, ErrorState, FormError, Skeleton } from '@/shared/ui';
import { useMfaEnable, useMfaSetup } from '../hooks/useAuthFlows';
import type { MfaChallenge } from '../model/session.store';
import { OtpCodeField } from './OtpCodeField';

const schema = z.object({ code: otpCodeSchema });
type Values = z.infer<typeof schema>;

/** Groups a base32 secret for easier manual typing: "ABCD EFGH …". */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * First admin login: enrol a TOTP authenticator. The QR code is rendered
 * locally — the secret is never sent to a third-party QR service.
 */
export function MfaSetupPanel({ challenge }: { challenge: MfaChallenge }) {
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [copied, setCopied] = useState(false);
  const requested = useRef(false);

  // Each setup call generates a new pending secret, so it must run exactly
  // once (StrictMode re-runs effects in development).
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    setup.mutate(challenge.mfaToken);
  }, [challenge.mfaToken, setup]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  const submit = handleSubmit(({ code }) => {
    if (enable.isPending) return;
    enable.mutate({ mfaToken: challenge.mfaToken, code });
  });

  if (setup.isError) return <ErrorState error={setup.error} />;

  const secret = setup.data?.secret;

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[15px] text-ink-secondary">
        <li>Telefoningizda authenticator ilovasini oching (Google Authenticator, Microsoft Authenticator yoki Authy).</li>
        <li>Quyidagi QR kodni skanerlang yoki kalitni qo‘lda kiriting.</li>
        <li>Ilova ko‘rsatgan 6 xonali kodni yozing.</li>
      </ol>

      <div className="flex flex-col items-center gap-3 rounded-[12px] border border-line bg-background px-4 py-5">
        {setup.data ? (
          <div className="rounded-[10px] bg-white p-3" aria-label="Authenticator uchun QR kod" role="img">
            <QRCodeSVG value={setup.data.otpauthUrl} size={176} level="M" />
          </div>
        ) : (
          <Skeleton className="size-[200px]" />
        )}
        {secret ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="text-[13px] text-ink-secondary">Qo‘lda kiritish uchun kalit:</p>
            <code className="rounded-[8px] border border-line bg-card px-3 py-2 text-center font-mono text-sm break-words text-ink">
              {groupSecret(secret)}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy aria-hidden className="size-4" />}
              onClick={() => {
                void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
              }}
            >
              {copied ? 'Nusxa olindi' : 'Kalitdan nusxa olish'}
            </Button>
          </div>
        ) : null}
      </div>

      <Alert tone="warning">Kalitni hech kimga bermang va ekran rasmini saqlamang.</Alert>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <OtpCodeField error={errors.code?.message} disabled={!setup.data} {...register('code')} />
        <FormError message={enable.error ? errorMessage(enable.error) : null} />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={enable.isPending}
          disabled={!setup.data}
          icon={<ShieldCheck aria-hidden className="size-5" />}
        >
          Yoqish va kirish
        </Button>
      </form>
    </div>
  );
}
