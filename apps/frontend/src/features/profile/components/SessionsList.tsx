import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { authApi } from '@/features/auth/api/auth.api';
import type { ActiveSession } from '@/features/auth/api/auth.types';
import { useLogoutAll } from '@/features/auth/hooks/useAuthFlows';
import { authKeys } from '@/features/auth/model/keys';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/format';
import { AsyncContent, Badge, Button, ConfirmDialog, toast } from '@/shared/ui';

function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: 'Noma’lum qurilma', mobile: false };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Brauzer';
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : '';
  return { label: os ? `${browser}, ${os}` : browser, mobile };
}

export function SessionsList() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: authKeys.sessions, queryFn: authApi.sessions });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      toast.success('Sessiya yopildi');
      return queryClient.invalidateQueries({ queryKey: authKeys.sessions });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const logoutAll = useLogoutAll();
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <AsyncContent
        query={sessions}
        collection
        isEmpty={(data) => data.length === 0}
        empty={<p className="py-6 text-center text-ink-secondary">Faol sessiyalar yo‘q</p>}
      >
        {(data: ActiveSession[]) => (
          <ul className="flex flex-col divide-y divide-line">
            {data.map((session) => {
              const device = describeDevice(session.userAgent);
              const Icon = device.mobile ? Smartphone : Monitor;
              return (
                <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-[10px] bg-neutral-light">
                    <Icon className="size-5 text-ink-secondary" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {device.label}
                      {session.current ? <Badge tone="success">Joriy qurilma</Badge> : null}
                    </p>
                    <p className="text-[13px] text-ink-secondary">
                      Oxirgi faollik: {formatDateTime(session.lastUsedAt)}
                      {session.ip ? ` · IP ${session.ip}` : ''}
                    </p>
                  </div>
                  {session.current ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={revoke.isPending && revoke.variables === session.id}
                      onClick={() => revoke.mutate(session.id)}
                    >
                      Yopish
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AsyncContent>

      <div className="border-t border-line pt-4">
        <Button variant="danger" icon={<LogOut aria-hidden className="size-5" />} onClick={() => setConfirmAll(true)}>
          Barcha qurilmalardan chiqish
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAll}
        title="Barcha qurilmalardan chiqish"
        message="Barcha sessiyalar, shu jumladan joriy qurilma ham yopiladi. Qayta kirishingiz kerak bo‘ladi."
        confirmLabel="Ha, chiqish"
        loading={logoutAll.isPending}
        error={logoutAll.error ? errorMessage(logoutAll.error) : null}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => logoutAll.mutate()}
      />
    </div>
  );
}
