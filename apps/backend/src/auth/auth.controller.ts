import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { ALL_ROLES } from '../common/auth/roles.js';
import { RequestContext } from '../common/context/request-context.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { IdParam } from '../common/decorators/id-param.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination/index.js';
import type { PublicUser } from '../common/selects/user.select.js';
import type { SessionMeta } from '../security/sessions/session.service.js';
import { SessionService } from '../security/sessions/session.service.js';
import { AuthCookies, isMobileClient } from './auth-cookies.js';
import { AuthService, type SessionView } from './auth.service.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaTokenDto,
  RefreshDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyPhoneDto,
} from './dto/auth.dto.js';
import {
  LoginService,
  type LoginOutcome,
  type MfaChallenge,
} from './login.service.js';
import { MfaService } from './mfa/mfa.service.js';
import type { VerificationResponse } from './otp.service.js';

export interface AuthenticatedBody {
  status: 'AUTHENTICATED';
  accessToken: string;
  accessTokenExpiresIn: number;
  user: PublicUser;
  /** Mobile clients only. */
  refreshToken?: string;
}

export interface RefreshBody {
  accessToken: string;
  accessTokenExpiresIn: number;
  /** Only when the refresh token was sent in the body (mobile). */
  refreshToken?: string;
}

function requestMeta(): SessionMeta {
  const context = RequestContext.get();
  return { ip: context?.ip, userAgent: context?.userAgent };
}

/**
 * Anonymous handlers carry @Public(), account handlers @Roles(...ALL_ROLES);
 * there is deliberately no class-level decorator (see route-guards test).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly loginService: LoginService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookies,
  ) {}

  @Public()
  @Post(['register', 'otp/send'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ro‘yxatdan o‘tish va telefon tasdiqlash so‘rovini qabul qilish',
  })
  @ApiAcceptedResponse({
    description: 'So‘rov qabul qilindi; bu SMS yetkazilganini anglatmaydi.',
    schema: {
      type: 'object',
      required: ['verificationId', 'expiresIn', 'resendAfter', 'message'],
      properties: {
        verificationId: { type: 'string', format: 'uuid' },
        expiresIn: { type: 'integer', example: 300 },
        resendAfter: { type: 'integer', example: 60 },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Telefon yoki IP limiti; Retry-After sarlavhasini tekshiring.',
  })
  register(@Body() dto: RegisterDto): Promise<VerificationResponse> {
    return this.auth.register(dto, requestMeta().ip);
  }

  @Public()
  @Post(['verify-phone', 'otp/verify'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ro‘yxatdan o‘tish sessiyasiga bog‘langan bir martalik kodni tekshirish',
  })
  @ApiOkResponse({
    description:
      'Telefon tasdiqlandi. Kirish uchun mavjud login endpointidan foydalaning.',
  })
  @ApiResponse({
    status: 400,
    description: 'Kod noto‘g‘ri, ishlatilgan yoki muddati tugagan.',
  })
  verifyPhone(@Body() dto: VerifyPhoneDto): Promise<{ message: string }> {
    return this.auth.verifyPhone(dto, requestMeta().ip);
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Mavjud tasdiqlash sessiyasi uchun yangi kod so‘rash',
  })
  @ApiAcceptedResponse({
    description:
      'So‘rov qabul qilindi; verificationId, expiresIn, resendAfter va message qaytariladi.',
  })
  @ApiResponse({
    status: 429,
    description:
      'Qayta yuborish cheklangan; Retry-After sarlavhasini tekshiring.',
  })
  resendOtp(@Body() dto: ResendOtpDto): Promise<VerificationResponse> {
    return this.auth.resendOtp(dto.verificationId, requestMeta().ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedBody | MfaChallenge> {
    this.guardCookieIssuer(req);
    const outcome = await this.loginService.login(dto, requestMeta());
    return this.respond(outcome, req, res);
  }

  @Public()
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  mfaSetup(
    @Body() dto: MfaTokenDto,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.mfa.setup(dto.mfaToken);
  }

  @Public()
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  async mfaEnable(
    @Body() dto: MfaCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedBody | MfaChallenge> {
    this.guardCookieIssuer(req);
    const outcome = await this.mfa.enable(
      dto.mfaToken,
      dto.code,
      requestMeta(),
    );
    return this.respond(outcome, req, res);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async mfaVerify(
    @Body() dto: MfaCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedBody | MfaChallenge> {
    this.guardCookieIssuer(req);
    const outcome = await this.mfa.verify(
      dto.mfaToken,
      dto.code,
      requestMeta(),
    );
    return this.respond(outcome, req, res);
  }

  /**
   * The response transport mirrors the request: a body token (mobile) gets
   * a body token back; the cookie (web) needs the CSRF header and is
   * answered with a new cookie only. A failed cookie refresh clears the
   * cookies (e.g. after reuse detection revoked the family).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshBody> {
    if (dto.refreshToken) {
      const issued = await this.sessions.rotate(
        dto.refreshToken,
        requestMeta(),
      );
      return {
        accessToken: issued.accessToken,
        accessTokenExpiresIn: issued.accessTokenExpiresIn,
        refreshToken: issued.refreshToken,
      };
    }
    const cookie = this.cookies.readRefresh(req);
    if (!cookie) throw Errors.unauthorized();
    this.cookies.assertCsrf(req);
    try {
      const issued = await this.sessions.rotate(cookie, requestMeta());
      this.cookies.rotate(
        res,
        issued.refreshToken,
        issued.refreshTokenExpiresAt,
      );
      return {
        accessToken: issued.accessToken,
        accessTokenExpiresIn: issued.accessTokenExpiresIn,
      };
    } catch (err) {
      this.cookies.clear(res);
      throw err;
    }
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user);
    this.cookies.clear(res);
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user);
    this.cookies.clear(res);
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Get('sessions')
  listSessions(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SessionView>> {
    return this.auth.listSessions(user, query);
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeSession(user, id);
    if (id === user.sessionId) this.cookies.clear(res);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<VerificationResponse> {
    return this.auth.forgotPassword(dto, requestMeta().ip);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.auth.resetPassword(dto, requestMeta().ip);
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user, dto);
  }

  @ApiBearerAuth()
  @Roles(...ALL_ROLES)
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user);
  }

  /** Checked before any work, so a forged request creates no session. */
  private guardCookieIssuer(req: Request): void {
    if (!isMobileClient(req)) this.cookies.assertCookieIssuer(req);
  }

  private respond(
    outcome: LoginOutcome,
    req: Request,
    res: Response,
  ): AuthenticatedBody | MfaChallenge {
    if (outcome.kind === 'mfa') return outcome.challenge;
    const { tokens, user } = outcome;
    const body: AuthenticatedBody = {
      status: 'AUTHENTICATED',
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      user,
    };
    if (isMobileClient(req)) {
      body.refreshToken = tokens.refreshToken;
    } else {
      this.cookies.issue(
        res,
        tokens.refreshToken,
        tokens.refreshTokenExpiresAt,
      );
    }
    return body;
  }
}
