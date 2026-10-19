import { ROLE_LABELS, STATUS_LABELS } from '@/features/auth/lib/permissions';
import type { UserRole, UserStatus } from '@/shared/types/api';
import { Badge, type BadgeTone } from '@/shared/ui';

const STATUS_TONES: Record<UserStatus, BadgeTone> = {
  ACTIVE: 'success',
  PENDING_VERIFICATION: 'warning',
  BLOCKED: 'danger',
  ARCHIVED: 'neutral',
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={role === 'FARMER' ? 'neutral' : 'primary'}>{ROLE_LABELS[role]}</Badge>;
}
