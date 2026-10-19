import { Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { can, ROLE_LABELS, STATUS_LABELS } from '@/features/auth/lib/permissions';
import { CreateUserDialog } from '@/features/users/components/CreateUserDialog';
import { RoleBadge, UserStatusBadge } from '@/features/users/components/UserBadges';
import { useUsersPage } from '@/features/users/model/users.queries';
import { formatDateTime } from '@/shared/lib/format';
import { formatPhone, normalizeUzPhone } from '@/shared/lib/phone';
import {
  DEFAULT_PAGE_SIZE,
  USER_ROLES,
  USER_STATUSES,
  type PublicUser,
  type UserRole,
  type UserStatus,
} from '@/shared/types/api';
import {
  AsyncContent,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  Pagination,
  Select,
  type Column,
} from '@/shared/ui';

const SORTS = [
  { value: '-createdAt', label: 'Eng yangilari' },
  { value: 'fullName', label: 'Ism bo‘yicha (A–Z)' },
  { value: '-lastLoginAt', label: 'Oxirgi kirish' },
] as const;

function oneOf<T extends string>(value: string | null, options: readonly T[]): T | undefined {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const { data: me } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const role = oneOf<UserRole>(params.get('role'), USER_ROLES);
  const status = oneOf<UserStatus>(params.get('status'), USER_STATUSES);
  const sort =
    oneOf(
      params.get('sort'),
      SORTS.map((option) => option.value),
    ) ?? '-createdAt';
  const phone = params.get('phone') ?? undefined;
  const demo = params.get('demo') === '1';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [phoneInput, setPhoneInput] = useState(phone ?? '');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);

  const query = {
    page,
    limit: DEFAULT_PAGE_SIZE,
    sort,
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(phone ? { phone } : {}),
    ...(demo ? { isDemo: true } : {}),
  };
  const users = useUsersPage(query);

  function update(changes: Record<string, string | null>): void {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  const columns: Column<PublicUser>[] = [
    {
      key: 'name',
      header: 'Ism va familiya',
      cell: (user) => (
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {user.fullName}
          {user.isDemo ? <Badge tone="neutral">Demo</Badge> : null}
        </span>
      ),
    },
    { key: 'phone', header: 'Telefon', className: 'whitespace-nowrap', cell: (user) => formatPhone(user.phone) },
    { key: 'email', header: 'Email', hideOnMobile: true, cell: (user) => user.email ?? '—' },
    { key: 'role', header: 'Rol', cell: (user) => <RoleBadge role={user.role} /> },
    { key: 'status', header: 'Holat', cell: (user) => <UserStatusBadge status={user.status} /> },
    {
      key: 'login',
      header: 'Oxirgi kirish',
      hideOnMobile: true,
      className: 'whitespace-nowrap',
      cell: (user) => formatDateTime(user.lastLoginAt),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-[1.8fr_1fr_1fr_1fr_auto] xl:items-end">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!phoneInput.trim()) {
                setPhoneError(undefined);
                update({ phone: null });
                return;
              }
              const normalized = normalizeUzPhone(phoneInput);
              if (!normalized) {
                setPhoneError('To‘liq raqam kiriting: +998 90 123 45 67');
                return;
              }
              setPhoneError(undefined);
              update({ phone: normalized });
            }}
          >
            <Field label="Telefon raqami" error={phoneError} className="flex-1">
              <Input
                type="search"
                inputMode="tel"
                placeholder="+998 90 123 45 67"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" icon={<Search aria-hidden className="size-4" />}>
              Izlash
            </Button>
          </form>
          <Field label="Rol">
            <Select value={role ?? ''} onChange={(event) => update({ role: event.target.value || null })}>
              <option value="">Barcha rollar</option>
              {USER_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Holat">
            <Select value={status ?? ''} onChange={(event) => update({ status: event.target.value || null })}>
              <option value="">Barcha holatlar</option>
              {USER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Saralash">
            <Select value={sort} onChange={(event) => update({ sort: event.target.value })}>
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {me && can.createUsers(me.role) ? (
            <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
              Foydalanuvchi qo‘shish
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <p className="text-sm text-ink-secondary">Har bir ko‘rish audit jurnaliga yoziladi.</p>
          <Checkbox
            label="Faqat demo hisoblar"
            checked={demo}
            onChange={(event) => update({ demo: event.target.checked ? '1' : null })}
          />
        </div>
      </Card>

      <Card>
        <AsyncContent
          query={users}
          collection
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              icon={<Users className="size-6" />}
              title="Foydalanuvchi topilmadi"
              description="Filtrlarni o‘zgartirib ko‘ring."
            />
          }
        >
          {(data) => (
            <>
              <DataTable
                caption="Foydalanuvchilar"
                columns={columns}
                rows={data.items}
                rowKey={(user) => user.id}
                onRowClick={(user) => navigate(`/admin/users/${user.id}`)}
              />
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={(next) => update({ page: String(next) })}
              />
            </>
          )}
        </AsyncContent>
      </Card>

      {me ? <CreateUserDialog open={creating} onClose={() => setCreating(false)} actorRole={me.role} /> : null}
    </div>
  );
}
