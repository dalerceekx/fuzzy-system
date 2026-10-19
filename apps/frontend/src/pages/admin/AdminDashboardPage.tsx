import { useQuery } from '@tanstack/react-query';
import { Ban, Clock, ScrollText, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { can, ROLE_LABELS } from '@/features/auth/lib/permissions';
import { auditApi } from '@/features/audit/api/audit.api';
import { auditActionLabel } from '@/features/audit/lib/actions';
import { useAllUsers } from '@/features/users/model/users.queries';
import { formatDateTime, formatInteger } from '@/shared/lib/format';
import { USER_ROLES } from '@/shared/types/api';
import { Alert, ButtonLink, Card, CardBody, CardHeader, ErrorState, Skeleton, StatCard } from '@/shared/ui';
import { BarList } from '@/shared/ui/charts';

function RecentAudit() {
  const logs = useQuery({ queryKey: ['audit-logs', 'recent'], queryFn: () => auditApi.list({ page: 1, limit: 8 }) });
  return (
    <Card>
      <CardHeader
        title="So‘nggi audit yozuvlari"
        icon={<ScrollText className="size-5" />}
        actions={
          <ButtonLink to="/admin/audit-logs" variant="ghost" size="sm">
            Barchasi
          </ButtonLink>
        }
      />
      {logs.isError ? (
        <ErrorState error={logs.error} collection onRetry={() => void logs.refetch()} />
      ) : logs.isPending ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : logs.data.items.length === 0 ? (
        <p className="px-5 py-8 text-center text-ink-secondary">Yozuvlar yo‘q</p>
      ) : (
        <ul className="divide-y divide-line">
          {logs.data.items.map((log) => (
            <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{auditActionLabel(log.action)}</span>
                <span className="block text-[13px] text-ink-secondary">
                  {log.actorRole ? ROLE_LABELS[log.actorRole] : 'Tizim / anonim'}
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-ink-secondary">{formatDateTime(log.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminDashboardPage() {
  const { data: me } = useCurrentUser();
  const users = useAllUsers();
  const items = users.data?.items ?? [];
  const countBy = (predicate: (user: (typeof items)[number]) => boolean) => items.filter(predicate).length;
  const roleData = USER_ROLES.map((role) => ({ label: ROLE_LABELS[role], count: countBy((user) => user.role === role) }));
  const loading = users.isPending;
  const failed = users.isError;

  return (
    <div className="flex flex-col gap-6">
      {me?.isDemo ? <Alert tone="info">Demo administrator faqat demo hisoblarni ko‘radi va boshqaradi.</Alert> : null}
      {users.data?.truncated ? (
        <Alert tone="warning">
          Foydalanuvchilar ko‘p — taqsimot birinchi 1 000 ta hisob bo‘yicha. Jami son serverdan aniq olingan.
        </Alert>
      ) : null}

      <section aria-label="Foydalanuvchilar ko‘rsatkichlari" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Users className="size-5" />}
          label="Jami foydalanuvchilar"
          value={formatInteger(users.data?.total)}
          loading={loading}
          failed={failed}
          to="/admin/users"
        />
        <StatCard
          icon={<UserCheck className="size-5" />}
          label="Faol"
          value={formatInteger(countBy((user) => user.status === 'ACTIVE'))}
          loading={loading}
          failed={failed}
          to="/admin/users?status=ACTIVE"
        />
        <StatCard
          icon={<Clock className="size-5" />}
          label="Tasdiqlanmagan"
          value={formatInteger(countBy((user) => user.status === 'PENDING_VERIFICATION'))}
          loading={loading}
          failed={failed}
          to="/admin/users?status=PENDING_VERIFICATION"
        />
        <StatCard
          icon={<Ban className="size-5" />}
          label="Bloklangan"
          value={formatInteger(countBy((user) => user.status === 'BLOCKED'))}
          loading={loading}
          failed={failed}
          to="/admin/users?status=BLOCKED"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Rollar bo‘yicha"
            icon={<ShieldCheck className="size-5" />}
            actions={
              <ButtonLink to="/admin/roles" variant="ghost" size="sm">
                Rollar
              </ButtonLink>
            }
          />
          <CardBody>
            {failed ? (
              <ErrorState error={users.error} collection onRetry={() => void users.refetch()} />
            ) : loading ? (
              <Skeleton className="h-[200px]" />
            ) : (
              <BarList
                label="Rollar bo‘yicha foydalanuvchilar"
                max={items.length}
                items={roleData.map((row) => ({
                  key: row.label,
                  label: row.label,
                  value: row.count,
                  display: `${formatInteger(row.count)} ta`,
                }))}
              />
            )}
          </CardBody>
        </Card>
        {me && can.viewAuditLogs(me.role) ? (
          <RecentAudit />
        ) : (
          <Card>
            <CardHeader title="Tezkor havolalar" />
            <CardBody className="flex flex-col gap-2">
              <Link to="/admin/users" className="font-medium text-warning hover:underline">
                Foydalanuvchilar ro‘yxati
              </Link>
              <Link to="/admin/medicines" className="font-medium text-warning hover:underline">
                Dorilar katalogi
              </Link>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
