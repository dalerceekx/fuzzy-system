import { ArrowLeft, UserRound } from 'lucide-react';
import { useParams } from 'react-router';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { RoleBadge, UserStatusBadge } from '@/features/users/components/UserBadges';
import { UserActions } from '@/features/users/components/UserActions';
import { useUser } from '@/features/users/model/users.queries';
import { formatDateTime, formatInteger } from '@/shared/lib/format';
import { formatPhone } from '@/shared/lib/phone';
import { AsyncContent, Badge, ButtonLink, Card, CardBody, CardHeader, DescriptionList } from '@/shared/ui';

export default function UserDetailsPage() {
  const { userId = '' } = useParams();
  const { data: me } = useCurrentUser();
  const user = useUser(userId);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to="/admin/users" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          Foydalanuvchilar
        </ButtonLink>
      </div>
      <Card>
        <AsyncContent query={user}>
          {(data) => {
            const sessions = data.sessionCount ?? data.activeSessionCount;
            return (
              <>
                <CardHeader
                  icon={<UserRound className="size-5" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {data.fullName}
                      {data.isDemo ? <Badge tone="neutral">Demo</Badge> : null}
                    </span>
                  }
                  description={formatPhone(data.phone)}
                  actions={
                    <>
                      <RoleBadge role={data.role} />
                      <UserStatusBadge status={data.status} />
                    </>
                  }
                />
                <CardBody className="flex flex-col gap-6">
                  <DescriptionList
                    items={[
                      { label: 'Telefon', value: formatPhone(data.phone) },
                      { label: 'Email', value: data.email ?? '—' },
                      { label: 'Telefon tasdiqlangan', value: formatDateTime(data.phoneVerifiedAt) },
                      { label: 'Ikki bosqichli himoya', value: data.mfaEnabled ? 'Yoqilgan' : 'Yoqilmagan' },
                      { label: 'Faol sessiyalar', value: sessions === undefined ? '—' : formatInteger(sessions) },
                      { label: 'Oxirgi kirish', value: formatDateTime(data.lastLoginAt) },
                      { label: 'Ro‘yxatdan o‘tgan', value: formatDateTime(data.createdAt) },
                      { label: 'Bloklangan', value: formatDateTime(data.blockedAt) },
                      { label: 'Arxivlangan', value: formatDateTime(data.archivedAt) },
                    ]}
                  />
                  {me ? (
                    <div className="border-t border-line pt-5">
                      <h3 className="mb-3 text-base font-semibold">Amallar</h3>
                      <UserActions actor={me} target={data} />
                    </div>
                  ) : null}
                </CardBody>
              </>
            );
          }}
        </AsyncContent>
      </Card>
    </div>
  );
}
