import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { assignableRoles, ROLE_LABELS } from '@/features/auth/lib/permissions';
import { errorMessage, validationFieldErrors } from '@/shared/api/errors';
import { normalizeUzPhone } from '@/shared/lib/phone';
import { newPasswordSchema, phoneSchema, requiredText } from '@/shared/lib/validation';
import { USER_ROLES, type UserRole } from '@/shared/types/api';
import { Alert, Button, Field, FormError, Input, Modal, PasswordInput, Select, toast } from '@/shared/ui';
import { useCreateUser } from '../model/users.queries';

const schema = z.object({
  fullName: requiredText('Ism va familiyani kiriting', 100).refine((value) => value.length >= 2, 'Kamida 2 ta belgi'),
  phone: phoneSchema,
  role: z.enum(USER_ROLES),
  password: newPasswordSchema,
});
type Values = z.infer<typeof schema>;

/** Staff onboarding: the backend creates an ACTIVE account with a verified phone. */
export function CreateUserDialog({ open, onClose, actorRole }: { open: boolean; onClose: () => void; actorRole: UserRole }) {
  const create = useCreateUser();
  const roles = assignableRoles(actorRole);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: '', role: roles.includes('VET') ? 'VET' : (roles[0] ?? 'FARMER'), password: '' },
  });

  useEffect(() => {
    if (open) {
      reset();
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = handleSubmit((values) => {
    if (create.isPending) return;
    create.mutate(
      { ...values, phone: normalizeUzPhone(values.phone) ?? values.phone },
      {
        onSuccess: (user) => {
          toast.success(`${user.fullName} hisobi yaratildi`);
          onClose();
        },
        onError: (error) => {
          const fieldErrors = validationFieldErrors(error, ['fullName', 'phone', 'role', 'password'] as const);
          for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof Values, { message });
        },
      },
    );
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yangi foydalanuvchi"
      description="Xodim yoki fermer hisobini yaratish"
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="create-user-form" loading={create.isPending}>
            Yaratish
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Ism va familiya" error={errors.fullName?.message} required>
          <Input data-autofocus autoComplete="off" {...register('fullName')} />
        </Field>
        <Field label="Telefon raqami" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" autoComplete="off" placeholder="+998 90 123 45 67" {...register('phone')} />
        </Field>
        <Field
          label="Rol"
          error={errors.role?.message}
          required
          hint={actorRole === 'ADMIN' ? 'Administrator faqat xodim va fermer rollarini bera oladi' : undefined}
        >
          <Select {...register('role')}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Boshlang‘ich parol"
          error={errors.password?.message}
          required
          hint="Kamida 8 ta belgi, harf va raqam. Foydalanuvchiga xavfsiz yo‘l bilan yetkazing."
        >
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <Alert tone="info">Administrator rollari birinchi kirishda ikki bosqichli himoyani (TOTP) majburiy sozlaydi.</Alert>
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </form>
    </Modal>
  );
}
