import { Check, Minus, ShieldCheck } from 'lucide-react';
import { ROLE_LABELS } from '@/features/auth/lib/permissions';
import { useAllUsers } from '@/features/users/model/users.queries';
import { formatInteger } from '@/shared/lib/format';
import { USER_ROLES, type UserRole } from '@/shared/types/api';
import { Alert, Card, CardBody, CardHeader } from '@/shared/ui';

const DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Tizimning to‘liq boshqaruvi, administratorlarni tayinlash. Ikki bosqichli himoya majburiy.',
  ADMIN: 'Foydalanuvchilar va xodimlarni boshqarish, audit jurnalini ko‘rish. Ikki bosqichli himoya majburiy.',
  SUPPORT: 'Foydalanuvchilarni ko‘rish (faqat o‘qish). Har bir ko‘rish auditga yoziladi.',
  VET: 'Dorilar katalogini yuritish va dorilarni tasdiqlash.',
  FARMER: 'O‘z fermasi: hayvonlar, yem va dori ombori, hisobotlar.',
};

/**
 * Read-only matrix of what each role can do, as enforced by the backend
 * (CONTRACT §4–§7). Roles are fixed server-side; assignment happens on the
 * user page.
 */
const MATRIX: Array<{ label: string; roles: readonly UserRole[] }> = [
  { label: 'Foydalanuvchilarni ko‘rish', roles: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'] },
  { label: 'Bloklash, arxivlash, sessiyalarni yopish', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Xodim / fermer hisobini yaratish', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Administrator rolini berish', roles: ['SUPER_ADMIN'] },
  { label: 'MFA’ni tiklash', roles: ['SUPER_ADMIN'] },
  { label: 'Audit jurnalini ko‘rish', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: 'Dori yaratish va arxivlash', roles: ['SUPER_ADMIN', 'ADMIN', 'VET'] },
  { label: 'Dorini tasdiqlash', roles: ['VET'] },
  { label: 'Ferma, hayvonlar va ombor', roles: ['FARMER'] },
];

export default function RolesPage() {
  const users = useAllUsers();
  const counts = new Map<UserRole, number>();
  for (const user of users.data?.items ?? []) counts.set(user.role, (counts.get(user.role) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        Rollar ro‘yxati serverda belgilangan va bu yerda o‘zgartirilmaydi. Foydalanuvchiga rol berish — “Foydalanuvchilar”
        sahifasida.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {USER_ROLES.map((role) => (
          <Card key={role} className="p-5">
            <p className="font-semibold text-ink">{ROLE_LABELS[role]}</p>
            <p className="mt-1 text-[28px] font-semibold tabular">
              {users.isPending ? '…' : users.isError ? '—' : formatInteger(counts.get(role) ?? 0)}
            </p>
            <p className="mt-1 text-[13px] text-ink-secondary">{DESCRIPTIONS[role]}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Huquqlar jadvali" description="Backend qoidalari asosida" icon={<ShieldCheck className="size-5" />} />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Rollar va huquqlar</caption>
            <thead>
              <tr className="border-b border-line bg-background/60">
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink-secondary">
                  Huquq
                </th>
                {USER_ROLES.map((role) => (
                  <th key={role} scope="col" className="px-3 py-3 text-center font-semibold text-ink-secondary">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                    {row.label}
                  </th>
                  {USER_ROLES.map((role) => (
                    <td key={role} className="px-3 py-3 text-center">
                      {row.roles.includes(role) ? (
                        <>
                          <Check aria-hidden className="mx-auto size-5 text-success" />
                          <span className="sr-only">Ha</span>
                        </>
                      ) : (
                        <>
                          <Minus aria-hidden className="mx-auto size-5 text-ink-muted" />
                          <span className="sr-only">Yo‘q</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
