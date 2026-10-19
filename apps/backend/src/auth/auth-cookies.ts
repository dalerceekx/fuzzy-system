import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { Errors } from '../common/errors/app.exception.js';
import type { Env } from '../config/env.js';
import { randomToken, safeEqual } from '../security/crypto.js';
import { AuthMessages } from './auth.constants.js';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const CSRF_HEADER = 'x-csrf-token';
export const CLIENT_TYPE_HEADER = 'x-client-type';

const csrfFailed = () =>
  Errors.forbidden(AuthMessages.csrfFailed, 'CSRF_FAILED');

/** Mobile apps get the refresh token in the body instead of cookies. */
export function isMobileClient(req: Request): boolean {
  return req.get(CLIENT_TYPE_HEADER)?.trim().toLowerCase() === 'mobile';
}

/**
 * Web refresh-token transport: an HttpOnly cookie scoped to /api/v1/auth
 * plus a double-submit CSRF cookie (readable by the SPA, sent back as the
 * X-CSRF-Token header). The __Secure-/__Host- prefixes make browsers refuse
 * cookies set over plain HTTP or (for __Host-) with a Domain/Path override.
 */
@Injectable()
export class AuthCookies {
  readonly refreshName: string;
  readonly csrfName: string;
  private readonly secure: boolean;
  private readonly sameSite: 'strict' | 'lax';
  private readonly domain?: string;
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.secure = config.get('AUTH_COOKIE_SECURE', { infer: true });
    this.sameSite = config.get('AUTH_COOKIE_SAMESITE', { infer: true });
    this.domain = config.get('AUTH_COOKIE_DOMAIN', { infer: true });
    this.allowedOrigins = new Set(config.get('CORS_ORIGINS', { infer: true }));
    this.refreshName = this.secure ? '__Secure-mf_rt' : 'mf_rt';
    this.csrfName = this.secure ? '__Host-mf_csrf' : 'mf_csrf';
  }

  /** New login: refresh cookie + a fresh CSRF token. */
  issue(res: Response, refreshToken: string, expiresAt: Date): void {
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
    res.cookie(this.refreshName, refreshToken, {
      ...this.refreshOptions(),
      maxAge,
    });
    res.cookie(this.csrfName, randomToken(32), {
      ...this.csrfOptions(),
      maxAge,
    });
  }

  /** Rotation keeps the CSRF token; only the refresh cookie changes. */
  rotate(res: Response, refreshToken: string, expiresAt: Date): void {
    res.cookie(this.refreshName, refreshToken, {
      ...this.refreshOptions(),
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }

  clear(res: Response): void {
    res.clearCookie(this.refreshName, this.refreshOptions());
    res.clearCookie(this.csrfName, this.csrfOptions());
  }

  readRefresh(req: Request): string | undefined {
    return this.readCookie(req, this.refreshName);
  }

  /**
   * Gate for web requests that set auth cookies (login, MFA). Blocks login
   * CSRF: browsers accept Set-Cookie on a top-level cross-site form POST
   * even for SameSite=Strict cookies, but such a form can neither send
   * application/json nor hide its foreign Origin.
   */
  assertCookieIssuer(req: Request): void {
    const ok =
      this.isSameSite(req) && req.is('application/json') === 'application/json';
    if (!ok) throw csrfFailed();
  }

  /**
   * Double-submit check for cookie-authenticated requests: the header must
   * equal the CSRF cookie (another site can neither read the cookie nor set
   * the header), and the request must not come from a foreign origin.
   */
  assertCsrf(req: Request): void {
    const cookie = this.readCookie(req, this.csrfName);
    const header = req.get(CSRF_HEADER);
    const ok =
      this.isSameSite(req) &&
      typeof cookie === 'string' &&
      cookie.length >= 32 &&
      typeof header === 'string' &&
      safeEqual(header, cookie);
    if (!ok) throw csrfFailed();
  }

  private isSameSite(req: Request): boolean {
    const origin = req.get('origin');
    return (
      (origin === undefined || this.allowedOrigins.has(origin)) &&
      req.get('sec-fetch-site')?.toLowerCase() !== 'cross-site'
    );
  }

  private readCookie(req: Request, name: string): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' && value.length > 0 && value.length <= 4096
      ? value
      : undefined;
  }

  private refreshOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path: REFRESH_COOKIE_PATH,
      ...(this.domain ? { domain: this.domain } : {}),
    };
  }

  // __Host- cookies must have Path=/ and no Domain.
  private csrfOptions(): CookieOptions {
    return {
      httpOnly: false,
      secure: this.secure,
      sameSite: this.sameSite,
      path: '/',
    };
  }
}
