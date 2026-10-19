import { Archive, Ban, KeyRound, LogOut, RotateCcw, ShieldCheck, UserCog } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { assignableRoles, can, canActOn, ROLE_LABELS } from '@/features/auth/lib/permissions';
import { errorMessage } from '@/shared/api/errors';
import type { PublicUser, UserRole } from '@/shared/types/api';
import { Alert, Button, ConfirmDialog, Field, Select, Textarea, toast } from '@/shared/ui';
import {
  useArchiveUser,
  useBlockUser,
  useChangeRole,
  useResetUserMfa,
  useRevokeUserSessions,
  useUnblockUser,
} from '../model/users.queries';

type Action = 'role' | 'block' | 'unblock' | 'archive' | 'sessions' | 'mfa';

const MAX_REASON = 500;

/**
 * Admin actions on one user. Buttons follow the backend rules (no
 * self-actions, ADMIN cannot touch admins, MFA reset is SUPER_ADMIN only);
 * the server re-checks everything inside its transaction.
 */
export function UserActions({ actor, target }: { actor: PublicUser; target: PublicUser }) {
  const navigate = useNavigate();
  const [action, setAction] = useState<Action | null>(null);
  const [role, setRole] = useState<UserRole>(target.role);
  const [reason, setReason] = useState('');
  const changeRole = useChangeRole();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const archive = useArchiveUser();
  const revoke = useRevokeUserSessions();
  const resetMfa = useResetUserMfa();
  const mutations = { role: changeRole, block, unblock, archive, sessions: revoke, mfa: resetMfa };

  if (!can.manageUsers(actor.role)) return null;
  if (!canActOn(actor, target)) {
    return (
      <Alert tone="info">
        {actor.id === target.id
          ? 'O‘z hisobingizga nisbatan administrator amallarini bajarib bo‘lmaydi.'
          : 'Administrator boshqa administrator yoki super admin hisobini o‘zgartira olmaydi.'}
      </Alert>
    );
  }
  if (target.status === 'ARCHIVED') return <Alert tone="info">Arxivlangan hisob ustida amallar bajarilmaydi.</Alert>;

  const roles = assignableRoles(actor.role);
  const current = action ? mutations[action] : null;

  function open(next: Action): void {
    setAction(next);
    setReason('');
    setRole(target.role);
    for (const mutation of Object.values(mutations)) mutation.reset();
  }

  function done(message: string): void {
    toast.success(message);
    setAction(null);
  }

  function confirm(): void {
    if (!action || current?.isPending) return;
    const trimmed = reason.trim();
    switch (action) {
      case 'role':
        changeRole.mutate(
          { id: target.id, role },
          { onSuccess: () => done('Rol o‘zgartirildi. Foydalanuvchi qaytadan kirishi kerak.') },
        );
        break;
      case 'block':
        block.mutate({ id: target.id, reason: trimmed }, { onSuccess: () => done('Hisob bloklandi') });
        break;
      case 'unblock':
        unblock.mutate(target.id, { onSuccess: () => done('Blok olib tashlandi') });
        break;
      case 'archive':
        archive.mutate(
          { id: target.id, reason: trimmed },
          {
            onSuccess: () => {
              done('Hisob arxivlandi');
              navigate('/admin/users');
            },
          },
        );
        break;
      case 'sessions':
        revoke.mutate(target.id, { onSuccess: () => done('Barcha sessiyalar yopildi') });
        break;
      case 'mfa':
        resetMfa.mutate(target.id, { onSuccess: () => done('Ikki bosqichli himoya qayta sozlashga qo‘yildi') });
        break;
    }
  }

  const dialogs: Record<
    Action,
    { title: string; message: ReactNode; confirmLabel: string; tone: 'danger' | 'primary'; needsReason?: boolean }
  > = {
    role: {
      title: 'Rolni o‘zgartirish',
      message: 'Rol darhol kuchga kiradi va foydalanuvchining barcha sessiyalari yopiladi.',
      confirmLabel: 'Rolni saqlash',
      tone: 'primary',
    },
    block: {
      title: 'Hisobni bloklash',
      message: 'Foydalanuvchi tizimga kira olmaydi, barcha sessiyalari yopiladi.',
      confirmLabel: 'Bloklash',
      tone: 'danger',
      needsReason: true,
    },
    unblock: {
      title: 'Blokdan chiqarish',
      message: 'Foydalanuvchi yana tizimga kira oladi.',
      confirmLabel: 'Blokdan chiqarish',
      tone: 'primary',
    },
    archive: {
      title: 'Hisobni arxivlash',
      message:
        'Hisob o‘chirilmaydi, lekin faol ro‘yxatdan olinadi va tizimga kirish to‘xtatiladi. Bu amalni ortga qaytarish API’da yo‘q.',
      confirmLabel: 'Arxivlash',
      tone: 'danger',
      needsReason: true,
    },
    sessions: {
      title: 'Barcha sessiyalarni yopish',
      message: 'Foydalanuvchi barcha qurilmalarda tizimdan chiqariladi.',
      confirmLabel: 'Sessiyalarni yopish',
      tone: 'danger',
    },
    mfa: {
      title: 'Ikki bosqichli himoyani tiklash',
      message: 'Authenticator bog‘lanishi o‘chiriladi; keyingi kirishda foydalanuvchi uni qayta sozlaydi.',
      confirmLabel: 'Tiklash',
      tone: 'danger',
    },
  };
  const dialog = action ? dialogs[action] : null;
  const reasonMissing = Boolean(dialog?.needsReason) && reason.trim().length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<UserCog aria-hidden className="size-4" />} onClick={() => open('role')}>
          Rolni o‘zgartirish
        </Button>
        {target.status === 'BLOCKED' ? (
          <Button variant="secondary" icon={<RotateCcw aria-hidden className="size-4" />} onClick={() => open('unblock')}>
            Blokdan chiqarish
          </Button>
        ) : (
          <Button variant="secondary" icon={<Ban aria-hidden className="size-4" />} onClick={() => open('block')}>
            Bloklash
          </Button>
        )}
        <Button variant="secondary" icon={<LogOut aria-hidden className="size-4" />} onClick={() => open('sessions')}>
          Sessiyalarni yopish
        </Button>
        {can.resetMfa(actor.role) && target.mfaEnabled ? (
          <Button variant="secondary" icon={<KeyRound aria-hidden className="size-4" />} onClick={() => open('mfa')}>
            MFA’ni tiklash
          </Button>
        ) : null}
        <Button variant="danger" icon={<Archive aria-hidden className="size-4" />} onClick={() => open('archive')}>
          Arxivlash
        </Button>
      </div>

      {dialog && action ? (
        <ConfirmDialog
          open
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          loading={current?.isPending ?? false}
          error={current?.error ? errorMessage(current.error) : null}
          confirmDisabled={reasonMissing || (action === 'role' && role === target.role)}
          onCancel={() => setAction(null)}
          onConfirm={confirm}
        >
          {action === 'role' ? (
            <Field label="Yangi rol" required>
              <Select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                {[...new Set([target.role, ...roles])].map((value) => (
                  <option key={value} value={value} disabled={!roles.includes(value)}>
                    {ROLE_LABELS[value]}
                    {value === target.role ? ' (joriy)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {action === 'role' && (role === 'ADMIN' || role === 'SUPER_ADMIN') ? (
            <p className="flex items-center gap-2 text-sm text-ink-secondary">
              <ShieldCheck aria-hidden className="size-4" />
              Bu rol uchun ikki bosqichli himoya majburiy.
            </p>
          ) : null}
          {dialog.needsReason ? (
            <Field label="Sabab" required hint="Audit jurnalida saqlanadi">
              <Textarea rows={3} maxLength={MAX_REASON} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
