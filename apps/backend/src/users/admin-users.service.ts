import { Injectable } from '@nestjs/common';
import { AuditAction, type AuditActionValue } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { ADMIN_ROLES } from '../common/auth/roles.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { maskPhone } from '../common/phone.js';
import {
  USER_PUBLIC_SELECT,
  type PublicUser,
} from '../common/selects/user.select.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  SessionRevokeReason,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums.js';
import {
  dbErrorInfo,
  isCheckViolation,
  isUniqueViolation,
  PrismaService,
  type Tx,
} from '../prisma/prisma.service.js';
import { PasswordService } from '../security/password.service.js';
import { SessionService } from '../security/sessions/session.service.js';
import {
  AdminErrors,
  assertActorAllowed,
  assertMayActOn,
  assertMayGrant,
  reducesActiveSuperAdmins,
} from './admin-policy.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import {
  countOtherActiveSuperAdmins,
  lockSuperAdminChanges,
} from './super-admin-lock.js';

export type AdminUserView = PublicUser & { activeSessionCount: number };

interface MutationContext {
  tx: Tx;
  actor: PublicUser;
  target: PublicUser;
}

const SUPER_ADMIN_ONLY: readonly UserRole[] = [UserRole.SUPER_ADMIN];

const SORT_MAPPING = {
  createdAt: (dir: 'asc' | 'desc') => ({ createdAt: dir }),
  fullName: (dir: 'asc' | 'desc') => ({ fullName: dir }),
  lastLoginAt: (dir: 'asc' | 'desc') => ({
    lastLoginAt: { sort: dir, nulls: 'last' },
  }),
};

const AUDIT_ID_CHUNK = 50;

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(
    actor: AuthUser,
    query: ListUsersQueryDto,
  ): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      AND: [
        // Demo actors only ever see demo users; everyone else sees demo
        // users only when asking for them explicitly.
        { isDemo: query.isDemo ?? actor.isDemo },
        actor.isDemo ? { isDemo: true } : {},
        query.role ? { role: query.role } : {},
        query.status ? { status: query.status } : {},
        query.phone ? { phone: query.phone } : {},
      ],
    };
    const orderBy = [
      ...buildOrderBy(query.sort, SORT_MAPPING, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.UserOrderByWithRelationInput[];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
        select: USER_PUBLIC_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    await this.audit.record({
      action: AuditAction.USER_LIST_VIEWED,
      resourceType: 'user',
      // A lookup that found exactly one account (e.g. by phone) is filed
      // under that account, like GET /:id, so "who looked at user X" works.
      resourceId: items.length === 1 ? items[0].id : null,
      newValue: {
        filters: {
          role: query.role ?? null,
          status: query.status ?? null,
          phoneMasked: query.phone ? maskPhone(query.phone) : null,
          isDemo: query.isDemo ?? null,
          sort: query.sort ?? null,
        },
        page: query.page,
        limit: query.limit,
        returned: items.length,
        // Chunked: the audit sanitizer keeps at most 50 items per array and
        // a page holds up to MAX_PAGE_SIZE users.
        userIds: chunk(
          items.map((user) => user.id),
          AUDIT_ID_CHUNK,
        ),
      },
    });
    return paginated(items, total, query);
  }

  /** Every staff read is audited: the "who looked at this user" trail. */
  async get(actor: AuthUser, id: string): Promise<AdminUserView> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...(actor.isDemo ? { isDemo: true } : {}) },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) throw Errors.notFound();
    const activeSessionCount = await this.prisma.session.count({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    await this.audit.record({
      action: AuditAction.USER_VIEWED,
      resourceType: 'user',
      resourceId: id,
    });
    return { ...user, activeSessionCount };
  }

  // ------------------------------------------------------------ mutations

  async create(actor: AuthUser, dto: CreateUserDto): Promise<PublicUser> {
    // Hashed before the transaction so no row lock is held during scrypt.
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.lockAndRead(tx, [actor.id]);
        const acting = current.get(actor.id);
        assertActorAllowed(acting, ADMIN_ROLES);
        // Demo and real accounts share one phone namespace, so any create by
        // a demo actor would reveal (409) whether a real account exists.
        if (acting.isDemo) throw AdminErrors.demoCreate();
        assertMayGrant(acting.role, dto.role);

        const now = new Date();
        const user = await tx.user.create({
          data: {
            phone: dto.phone,
            fullName: dto.fullName,
            passwordHash,
            role: dto.role,
            status: UserStatus.ACTIVE,
            phoneVerifiedAt: now,
          },
          select: USER_PUBLIC_SELECT,
        });
        await this.audit.record(
          {
            action: AuditAction.USER_CREATED_BY_ADMIN,
            resourceType: 'user',
            resourceId: user.id,
            newValue: {
              role: user.role,
              status: user.status,
              phoneMasked: maskPhone(user.phone),
              isDemo: user.isDemo,
            },
          },
          tx,
        );
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw Errors.conflict(
          'PHONE_TAKEN',
          'Bu telefon raqami allaqachon ro‘yxatdan o‘tgan',
        );
      }
      throw err;
    }
  }

  changeRole(
    actor: AuthUser,
    targetId: string,
    role: UserRole,
  ): Promise<PublicUser> {
    return this.mutate(actor, targetId, ADMIN_ROLES, async (ctx) => {
      assertMayGrant(ctx.actor.role, role);
      if (ctx.target.role === role) return ctx.target;
      await this.assertSuperAdminRemains(ctx, { role });

      const user = await ctx.tx.user.update({
        where: { id: targetId },
        data: { role },
        select: USER_PUBLIC_SELECT,
      });
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.ROLE_CHANGED,
      );
      await this.record(ctx, AuditAction.USER_ROLE_CHANGED, {
        oldValue: { role: ctx.target.role },
        newValue: { role, revokedSessions },
      });
      return user;
    });
  }

  block(actor: AuthUser, targetId: string, reason: string) {
    return this.mutate(actor, targetId, ADMIN_ROLES, async (ctx) => {
      if (ctx.target.status === UserStatus.BLOCKED) {
        throw Errors.conflict(
          'USER_ALREADY_BLOCKED',
          'Foydalanuvchi allaqachon bloklangan',
        );
      }
      await this.assertSuperAdminRemains(ctx, { status: UserStatus.BLOCKED });

      const user = await ctx.tx.user.update({
        where: { id: targetId },
        data: {
          status: UserStatus.BLOCKED,
          blockedAt: new Date(),
          blockedReason: reason,
        },
        select: USER_PUBLIC_SELECT,
      });
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.USER_BLOCKED,
      );
      await this.record(ctx, AuditAction.USER_BLOCKED, {
        oldValue: { status: ctx.target.status },
        newValue: { status: user.status, reason, revokedSessions },
      });
      return user;
    });
  }

  unblock(actor: AuthUser, targetId: string) {
    return this.mutate(actor, targetId, ADMIN_ROLES, async (ctx) => {
      if (ctx.target.status !== UserStatus.BLOCKED) {
        throw Errors.conflict('USER_NOT_BLOCKED', 'Foydalanuvchi bloklanmagan');
      }
      if (!ctx.target.phoneVerifiedAt) {
        throw Errors.conflict(
          'PHONE_NOT_VERIFIED',
          'Telefon raqami tasdiqlanmagan',
        );
      }
      const user = await ctx.tx.user.update({
        where: { id: targetId },
        data: {
          status: UserStatus.ACTIVE,
          blockedAt: null,
          blockedReason: null,
        },
        select: USER_PUBLIC_SELECT,
      });
      // Nothing issued before the block may come back to life.
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.ADMIN_REVOKED,
      );
      await this.record(ctx, AuditAction.USER_UNBLOCKED, {
        oldValue: { status: ctx.target.status },
        newValue: { status: user.status, revokedSessions },
      });
      return user;
    });
  }

  archive(actor: AuthUser, targetId: string, reason: string) {
    return this.mutate(actor, targetId, ADMIN_ROLES, async (ctx) => {
      await this.assertSuperAdminRemains(ctx, { status: UserStatus.ARCHIVED });

      const user = await ctx.tx.user.update({
        where: { id: targetId },
        data: { status: UserStatus.ARCHIVED, archivedAt: new Date() },
        select: USER_PUBLIC_SELECT,
      });
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.USER_ARCHIVED,
      );
      await this.record(ctx, AuditAction.USER_ARCHIVED, {
        oldValue: { status: ctx.target.status },
        newValue: { status: user.status, reason, revokedSessions },
      });
      return user;
    });
  }

  revokeAllSessions(
    actor: AuthUser,
    targetId: string,
  ): Promise<{ revokedSessions: number }> {
    return this.mutate(actor, targetId, ADMIN_ROLES, async (ctx) => {
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.ADMIN_REVOKED,
      );
      await this.record(ctx, AuditAction.USER_SESSIONS_REVOKED, {
        newValue: { revokedSessions },
      });
      return { revokedSessions };
    });
  }

  resetMfa(actor: AuthUser, targetId: string): Promise<PublicUser> {
    return this.mutate(actor, targetId, SUPER_ADMIN_ONLY, async (ctx) => {
      const user = await ctx.tx.user.update({
        where: { id: targetId },
        data: {
          mfaEnabled: false,
          mfaSecretEnc: null,
          mfaPendingSecretEnc: null,
          mfaLastUsedStep: null,
        },
        select: USER_PUBLIC_SELECT,
      });
      const revokedSessions = await this.revokeSessions(
        ctx,
        SessionRevokeReason.MFA_RESET,
      );
      // Keys containing "mfa"/"otp" are redacted by the audit sanitizer.
      await this.record(ctx, AuditAction.AUTH_MFA_RESET, {
        oldValue: { secondFactorEnrolled: ctx.target.mfaEnabled },
        newValue: { secondFactorEnrolled: false, revokedSessions },
      });
      return user;
    });
  }

  // -------------------------------------------------------------- helpers

  /**
   * Runs one admin mutation in a transaction that re-reads the actor and
   * the target under row locks and decides every rule on that fresh state
   * (the role the guard saw may already be stale).
   */
  private async mutate<T>(
    actor: AuthUser,
    targetId: string,
    allowedRoles: readonly UserRole[],
    operation: (ctx: MutationContext) => Promise<T>,
  ): Promise<T> {
    if (actor.id === targetId) throw AdminErrors.selfAction();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockSuperAdminChanges(tx);
        const current = await this.lockAndRead(tx, [actor.id, targetId]);
        const acting = current.get(actor.id);
        const target = current.get(targetId);
        assertActorAllowed(acting, allowedRoles);
        assertMayActOn(acting, target);
        return operation({ tx, actor: acting, target });
      });
    } catch (err) {
      // The deferred trigger raises a check_violation without a constraint
      // name at COMMIT; only reachable if the check above was bypassed.
      if (isCheckViolation(err) && !dbErrorInfo(err)?.constraint) {
        throw AdminErrors.lastSuperAdmin();
      }
      throw err;
    }
  }

  /** Row-locks the users (in id order: no deadlocks) and reads them. */
  private async lockAndRead(
    tx: Tx,
    ids: string[],
  ): Promise<Map<string, PublicUser>> {
    const sorted = [...new Set(ids)].sort();
    await tx.$executeRaw`
      SELECT 1 FROM users WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
    const users = await tx.user.findMany({
      where: { id: { in: sorted } },
      select: USER_PUBLIC_SELECT,
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private async assertSuperAdminRemains(
    ctx: MutationContext,
    next: { role?: UserRole; status?: UserStatus },
  ): Promise<void> {
    if (!reducesActiveSuperAdmins(ctx.target, next)) return;
    // Counted under the advisory lock taken in mutate(), so two concurrent
    // demotions cannot both see "another one remains".
    if ((await countOtherActiveSuperAdmins(ctx.tx, ctx.target.id)) === 0) {
      throw AdminErrors.lastSuperAdmin();
    }
  }

  private revokeSessions(
    ctx: MutationContext,
    reason: SessionRevokeReason,
  ): Promise<number> {
    return this.sessions.revokeAllForUser(ctx.target.id, reason, {
      tx: ctx.tx,
    });
  }

  private record(
    ctx: MutationContext,
    action: AuditActionValue,
    values: { oldValue?: unknown; newValue?: unknown },
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        resourceType: 'user',
        resourceId: ctx.target.id,
        actorId: ctx.actor.id,
        actorRole: ctx.actor.role,
        ...values,
      },
      ctx.tx,
    );
  }
}
