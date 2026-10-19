import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { errorMessage, toApiError } from '@/shared/api/errors';
import { env } from '@/shared/config/env';
import { normalizeUzPhone } from '@/shared/lib/phone';
import { phoneSchema } from '@/shared/lib/validation';
import { Alert, Button, Field, FormError, Input, PasswordInput } from '@/shared/ui';
import { useLogin } from '../hooks/useAuthFlows';

// Dev-only module: statically false in production builds, so neither the
// component nor any demo credential reaches the production bundle.
const DemoAccounts = import.meta.env.DEV ? lazy(() => import('./DemoAccounts')) : null;

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Parolni kiriting').max(128, 'Parol ko‘pi bilan 128 ta belgi'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm({ defaultPhone = '' }: { defaultPhone?: string }) {
  const login = useLogin();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: defaultPhone, password: '' },
  });

  const submit = handleSubmit((values) => {
    if (login.isPending) return;
    login.mutate({ phone: normalizeUzPhone(values.phone) ?? values.phone, password: values.password });
  });

  const apiError = login.error ? toApiError(login.error) : null;

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Telefon raqami" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" autoComplete="username" placeholder="+998 90 123 45 67" {...register('phone')} />
        </Field>
        <Field label="Parol" error={errors.password?.message} required>
          <PasswordInput autoComplete="current-password" placeholder="Parolingiz" {...register('password')} />
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-warning underline-offset-4 hover:underline">
            Parolni unutdingizmi?
          </Link>
        </div>

        {apiError?.code === 'PHONE_NOT_VERIFIED' ? (
          <Alert tone="warning" title="Telefon raqami tasdiqlanmagan" urgent>
            Ro‘yxatdan o‘tishni yakunlang: SMS orqali yangi kod olish uchun{' '}
            <Link to="/register" className="font-medium text-ink underline">
              ro‘yxatdan o‘tish
            </Link>{' '}
            sahifasidan qayta yuboring.
          </Alert>
        ) : (
          <FormError message={login.error ? errorMessage(login.error) : null} />
        )}

        <Button type="submit" size="lg" fullWidth loading={login.isPending} icon={<LogIn aria-hidden className="size-5" />}>
          Kirish
        </Button>
      </form>

      <p className="text-center text-[13px] text-ink-secondary">
        Hozircha telefon raqami va parol bilan kirish mumkin. Email va SMS-kod orqali kirish tez orada qo‘shiladi.
      </p>

      {DemoAccounts && env.showDemoAccounts ? (
        <Suspense fallback={null}>
          <DemoAccounts
            disabled={login.isPending}
            onPick={(phone, password) => {
              setValue('phone', phone, { shouldValidate: true });
              setValue('password', password, { shouldValidate: true });
              void submit();
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
