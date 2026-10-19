import { ChevronDown, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useLogout } from '@/features/auth/hooks/useAuthFlows';
import { ROLE_LABELS } from '@/features/auth/lib/permissions';
import { formatPhone } from '@/shared/lib/phone';
import { initials } from '@/shared/lib/format';
import type { PublicUser } from '@/shared/types/api';
import { Menu, type MenuItem } from '@/shared/ui';

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-ink"
    >
      {initials(name)}
    </span>
  );
}

/** Pill-shaped profile control in the top-right corner. */
export function ProfileMenu({ user }: { user: PublicUser }) {
  const logout = useLogout();
  const items: MenuItem[] = [
    { kind: 'link', label: 'Profilim', to: '/profile', icon: <UserRound className="size-5" /> },
    { kind: 'link', label: 'Email qo‘shish', to: '/profile/email', icon: <Mail className="size-5" /> },
    { kind: 'link', label: 'Parolni almashtirish', to: '/profile/password', icon: <KeyRound className="size-5" /> },
    { kind: 'link', label: 'Kirish usullari', to: '/profile/security', icon: <ShieldCheck className="size-5" /> },
    { kind: 'separator' },
    {
      kind: 'action',
      label: logout.isPending ? 'Chiqilmoqda…' : 'Chiqish',
      icon: <LogOut className="size-5" />,
      tone: 'danger',
      onSelect: () => {
        if (!logout.isPending) logout.mutate();
      },
    },
  ];

  return (
    <Menu
      label="Profil menyusi"
      items={items}
      header={
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{user.fullName}</p>
          <p className="truncate text-[13px] text-ink-secondary">{formatPhone(user.phone)}</p>
        </div>
      }
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Profil: ${user.fullName}, ${ROLE_LABELS[user.role]}`}
          className="flex min-h-11 items-center gap-2.5 rounded-full border border-line bg-card py-1 pr-3 pl-1 transition-colors hover:border-input-line aria-expanded:border-primary-hover"
        >
          <Avatar name={user.fullName} />
          <span className="hidden min-w-0 flex-col text-left leading-tight sm:flex">
            <span className="max-w-[160px] truncate text-sm font-semibold text-ink">{user.fullName}</span>
            <span className="max-w-[160px] truncate text-[12px] text-ink-secondary">{ROLE_LABELS[user.role]}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-ink-secondary" />
        </button>
      )}
    />
  );
}
