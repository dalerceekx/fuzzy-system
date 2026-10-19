import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '../../audit/audit-actions.js';
import { AuditService } from '../../audit/audit.service.js';
import { isMfaRequiredRole } from '../../common/auth/roles.js';
import { Errors } from '../../common/errors/app.exception.js';
import { truncateOptional } from '../../common/strings.js';
import type { Env } from '../../config/env.js';
import {
  SessionRevokeReason,
  UserRole,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { TokenService } from '../tokens/token.service.js';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface ActiveSession {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  ip: string | null;
  userAgent: string | null;
}

interface SessionUserState {
  role: UserRole;
  status: UserStatus;
  isDemo: boolean;
}

/**
 * A Session row is one refresh-token family. The refresh token carries
 * (sid, jti); the row stores the only jti that may be used next. Rotation
 * swaps it atomically, so a token whose signature is valid but whose jti is
 * stale has already been used once: the family is revoked (reuse detection).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly refreshTtlSeconds: number;
  private readonly demoEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshTtlSeconds = config.get('JWT_REFRESH_TTL_SECONDS', {
      infer: true,
    });
    this.demoEnabled = config.get('DEMO_ACCOUNTS_ENABLED', { infer: true });
  }

  /** Whether a user in this state may hold a usable session. */
  isUserAllowed(user: SessionUserState, mfaVerifiedAt: Date | null): boolean {
    if (user.status !== UserStatus.ACTIVE) return false;
    if (user.isDemo && !this.demoEnabled) return false;
    if (isMfaRequiredRole(user.role) && !mfaVerifiedAt) return false;
    return true;
  }

  async createSession(
    user: { id: string; role: UserRole },
    meta: SessionMeta & { mfaVerified: boolean },
  ): Promise<IssuedTokens> {
    if (isMfaRequiredRole(user.role) && !meta.mfaVerified) {
      throw Errors.forbidden(
        'Ikki bosqichli tasdiqlash talab qilinadi',
        'MFA_REQUIRED',
      );
    }
    const now = new Date();
    const sessionId = randomUUID();
    const jti = randomUUID();
    const expiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        currentRefreshJti: jti,
        mfaVerifiedAt: meta.mfaVerified ? now : null,
        ip: truncateOptional(meta.ip, 45),
        userAgent: truncateOptional(meta.userAgent, 512),
        createdAt: now,
        lastUsedAt: now,
        expiresAt,
      },
    });
    return this.issue(user.id, sessionId, jti, expiresAt);
  }

  async rotate(refreshToken: string, meta: SessionMeta): Promise<IssuedTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        currentRefreshJti: true,
        revokedAt: true,
        expiresAt: true,
        mfaVerifiedAt: true,
        user: { select: { role: true, status: true, isDemo: true } },
      },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= now
    ) {
      throw Errors.unauthorized();
    }
    if (session.currentRefreshJti !== claims.jti) {
      await this.handleReuse(claims.sid, claims.sub, session.user.role, meta);
      throw Errors.unauthorized();
    }
    if (!this.isUserAllowed(session.user, session.mfaVerifiedAt)) {
      throw Errors.unauthorized();
    }

    const nextJti = randomUUID();
    const swapped = await this.prisma.$executeRaw`
      UPDATE sessions
      SET current_refresh_jti = ${nextJti}::uuid,
          refresh_count = refresh_count + 1,
          last_used_at = ${now}
      WHERE id = ${claims.sid}::uuid
        AND user_id = ${claims.sub}::uuid
        AND current_refresh_jti = ${claims.jti}::uuid
        AND revoked_at IS NULL
        AND expires_at > ${now}`;
    if (swapped !== 1) {
      // Lost a race since the read above: another request rotated (stale
      // jti → reuse) or revoked this family.
      const current = await this.prisma.session.findUnique({
        where: { id: claims.sid },
        select: { currentRefreshJti: true, revokedAt: true },
      });
      if (
        current &&
        !current.revokedAt &&
        current.currentRefreshJti !== claims.jti
      ) {
        await this.handleReuse(claims.sid, claims.sub, session.user.role, meta);
      }
      throw Errors.unauthorized();
    }
    // The family keeps its absolute lifetime; rotation never extends it.
    return this.issue(claims.sub, claims.sid, nextJti, session.expiresAt);
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevokeReason,
    tx?: Tx,
  ): Promise<boolean> {
    const { count } = await (tx ?? this.prisma).session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count === 1;
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    opts: { exceptSessionId?: string; tx?: Tx } = {},
  ): Promise<number> {
    const { count } = await (opts.tx ?? this.prisma).session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  listActive(userId: string): Promise<ActiveSession[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        ip: true,
        userAgent: true,
      },
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
  }

  private async issue(
    userId: string,
    sessionId: string,
    jti: string,
    expiresAt: Date,
  ): Promise<IssuedTokens> {
    const access = await this.tokens.signAccess(userId, sessionId);
    const refresh = await this.tokens.signRefresh(
      userId,
      sessionId,
      jti,
      expiresAt,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      sessionId,
    };
  }

  private async handleReuse(
    sessionId: string,
    userId: string,
    role: UserRole,
    meta: SessionMeta,
  ): Promise<void> {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const changed = await this.revokeSession(
        sessionId,
        SessionRevokeReason.REFRESH_TOKEN_REUSE,
        tx,
      );
      if (changed) {
        await this.audit.record(
          {
            action: AuditAction.AUTH_REFRESH_REUSE,
            resourceType: 'session',
            resourceId: sessionId,
            actorId: userId,
            actorRole: role,
            newValue: {
              revokedReason: SessionRevokeReason.REFRESH_TOKEN_REUSE,
            },
            ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
            ...(meta.userAgent !== undefined
              ? { userAgent: meta.userAgent }
              : {}),
          },
          tx,
        );
      }
      return changed;
    });
    if (revoked) {
      this.logger.warn(
        { sessionId, userId },
        'refresh token reuse detected; session family revoked',
      );
    }
  }
}
