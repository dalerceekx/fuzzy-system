import {
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest, AuthUser } from '../../common/auth/auth-user.js';
import { RequestContext } from '../../common/context/request-context.js';
import { Errors } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SessionService } from '../sessions/session.service.js';
import { TokenService } from '../tokens/token.service.js';
import { routeAccess } from './route-access.js';

const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;
const BEARER = /^Bearer ([A-Za-z0-9._-]{1,4096})$/i;

/**
 * Authenticates every non-@Public route from the `Authorization: Bearer`
 * header only (cookies are never accepted here, so no CSRF exposure). The
 * session and the user's current role/status are loaded from the database on
 * every request; the JWT carries no role.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    if (routeAccess(this.reflector, context).isPublic) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const match = BEARER.exec(request.headers.authorization ?? '');
    if (!match) throw Errors.unauthorized();

    const claims = await this.tokens.verifyAccess(match[1]);
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        mfaVerifiedAt: true,
        lastUsedAt: true,
        user: { select: { id: true, role: true, status: true, isDemo: true } },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      !this.sessions.isUserAllowed(session.user, session.mfaVerifiedAt)
    ) {
      throw Errors.unauthorized();
    }

    const user: AuthUser = {
      id: session.user.id,
      role: session.user.role,
      sessionId: session.id,
      isDemo: session.user.isDemo,
      mfaVerified: session.mfaVerifiedAt !== null,
    };
    request.user = user;
    RequestContext.set({ userId: user.id, role: user.role });

    if (
      now.getTime() - session.lastUsedAt.getTime() >
      LAST_USED_RESOLUTION_MS
    ) {
      await this.touch(session.id, now);
    }
    return true;
  }

  /** Best effort; never fails the request. */
  private async touch(sessionId: string, now: Date): Promise<void> {
    try {
      await this.prisma.session.updateMany({
        where: {
          id: sessionId,
          lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) },
        },
        data: { lastUsedAt: now },
      });
    } catch {
      this.logger.warn({ sessionId }, 'could not update session lastUsedAt');
    }
  }
}
