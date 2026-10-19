import { CircleCheck, KeyRound, Mail, MailX, Phone, ShieldCheck, ShieldAlert, UserRound } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { ROLE_LABELS, STATUS_LABELS } from '@/features/auth/lib/permissions';
import { ChangePasswordForm } from '@/features/profile/components/ChangePasswordForm';
import { SessionsList } from '@/features/profile/components/SessionsList';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/format';
import { formatPhone } from '@/shared/lib/phone';
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, Field, GapState, Input } from '@/shared/ui';

const TABS = [
  { to: '/profile', label: 'Profilim', icon: UserRound, end: true },
  { to: '/profile/email', label: 'Email', icon: Mail },
  { to: '/profile/password', label: 'Parol', icon: KeyRound },
  { to: '/profile/security', label: 'Kirish usullari', icon: ShieldCheck },
];

/** Shared shell for profile sections: one level of tabs, no nested menus. */
export function ProfileLayout() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Profil bo‘limlari" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary-hover bg-primary-light text-ink'
                  : 'border-line bg-card text-ink-secondary hover:text-ink',
              )
            }
          >
            <tab.icon aria-hidden className="size-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function ProfileOverviewPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader title="Shaxsiy ma’lumotlar" icon={<UserRound className="size-5" />} />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Ism va familiya', value: user.fullName },
              { label: 'Telefon raqami', value: formatPhone(user.phone) },
              { label: 'Rol', value: ROLE_LABELS[user.role] },
              {
                label: 'Holat',
                value: <Badge tone={user.status === 'ACTIVE' ? 'success' : 'warning'}>{STATUS_LABELS[user.status]}</Badge>,
              },
              { label: 'Email', value: user.email ?? 'Ulanmagan' },
              { label: 'Oxirgi kirish', value: formatDateTime(user.lastLoginAt) },
              { label: 'Ro‘yxatdan o‘tgan', value: formatDateTime(user.createdAt) },
            ]}
          />
          <p className="mt-5 text-[13px] text-ink-secondary">
            Ism yoki telefon raqamini o‘zgartirish hozircha administrator orqali amalga oshiriladi.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Xavfsizlik" icon={<ShieldCheck className="size-5" />} />
        <CardBody className="flex flex-col gap-3 text-[15px]">
          <p className="flex items-center gap-2">
            <Phone aria-hidden className="size-4 text-success" />
            Telefon {user.phoneVerifiedAt ? 'tasdiqlangan' : 'tasdiqlanmagan'}
          </p>
          <p className="flex items-center gap-2">
            {user.mfaEnabled ? (
              <ShieldCheck aria-hidden className="size-4 text-success" />
            ) : (
              <ShieldAlert aria-hidden className="size-4 text-warning" />
            )}
            Ikki bosqichli himoya {user.mfaEnabled ? 'yoqilgan' : 'yoqilmagan'}
          </p>
          <p className="flex items-center gap-2">
            {user.email ? (
              <CircleCheck aria-hidden className="size-4 text-success" />
            ) : (
              <MailX aria-hidden className="size-4 text-ink-secondary" />
            )}
            Email {user.email ? 'ulangan' : 'ulanmagan'}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export function ProfileEmailPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Email manzil"
        description="Tasdiqlangan email kelajakda tizimga kirish uchun ham ishlatiladi."
        icon={<Mail className="size-5" />}
        actions={user.email ? <Badge tone="success">Ulangan</Badge> : <Badge tone="neutral">Email ulanmagan</Badge>}
      />
      <CardBody className="flex flex-col gap-5">
        {user.email ? (
          <Field label="Joriy email">
            <Input value={user.email} readOnly />
          </Field>
        ) : null}
        <GapState
          className="py-8"
          title="Email qo‘shish va tasdiqlash hali backend’da mavjud emas"
          description="Server email ulash, tasdiqlash kodi yuborish va email orqali kirishni hozircha qo‘llab-quvvatlamaydi. Bu imkoniyat qo‘shilganda shu yerda paydo bo‘ladi."
        />
      </CardBody>
    </Card>
  );
}

export function ProfilePasswordPage() {
  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Parolni almashtirish"
        description="Yangi parol saqlangach, boshqa qurilmalardagi sessiyalar yopiladi."
        icon={<KeyRound className="size-5" />}
      />
      <CardBody>
        <ChangePasswordForm />
      </CardBody>
    </Card>
  );
}

export function ProfileSecurityPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Kirish usullari" icon={<ShieldCheck className="size-5" />} />
        <CardBody>
          <ul className="flex flex-col divide-y divide-line">
            <li className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Telefon + parol</p>
                <p className="text-[13px] text-ink-secondary">{formatPhone(user.phone)}</p>
              </div>
              <Badge tone="success">Faol</Badge>
            </li>
            <li className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Authenticator ilovasi (TOTP)</p>
                <p className="text-[13px] text-ink-secondary">Administratorlar uchun majburiy</p>
              </div>
              <Badge tone={user.mfaEnabled ? 'success' : 'neutral'}>{user.mfaEnabled ? 'Yoqilgan' : 'Yoqilmagan'}</Badge>
            </li>
            <li className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Email + parol</p>
                <p className="text-[13px] text-ink-secondary">Backend’da hali mavjud emas</p>
              </div>
              <Badge tone="warning">Tez orada</Badge>
            </li>
            <li className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">Telefon + SMS kod</p>
                <p className="text-[13px] text-ink-secondary">Backend’da hali mavjud emas</p>
              </div>
              <Badge tone="warning">Tez orada</Badge>
            </li>
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Faol sessiyalar" description="Tizimga kirilgan qurilmalar" icon={<KeyRound className="size-5" />} />
        <CardBody>
          <SessionsList />
        </CardBody>
      </Card>
      {!user.mfaEnabled && user.role !== 'FARMER' ? (
        <Alert tone="warning" className="xl:col-span-2">
          Administrator hisobi uchun ikki bosqichli himoya keyingi kirishda majburiy ravishda sozlanadi.
        </Alert>
      ) : null}
    </div>
  );
}
