import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuditAction } from '../../../src/audit/audit-actions.js';
import { AuditService } from '../../../src/audit/audit.service.js';
import type { AuthUser } from '../../../src/common/auth/auth-user.js';
import { ALL_ROLES } from '../../../src/common/auth/roles.js';
import { RequestContext } from '../../../src/common/context/request-context.js';
import { CurrentUser } from '../../../src/common/decorators/current-user.decorator.js';
import { IdParam } from '../../../src/common/decorators/id-param.decorator.js';
import { Public } from '../../../src/common/decorators/public.decorator.js';
import { Roles } from '../../../src/common/decorators/roles.decorator.js';
import { Errors } from '../../../src/common/errors/app.exception.js';
import { UserRole } from '../../../src/generated/prisma/enums.js';
import {
  IdempotencyKey,
  IDEMPOTENCY_REPLAYED_HEADER,
} from '../../../src/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../../src/idempotency/idempotency.service.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

export class ProbeEchoDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class ProbeFarmDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  fail?: string;
}

/**
 * `GET /test-probe/held` emits 'held-entered' once the handler runs, then
 * waits for 'release' — tests synchronize on real events, not sleeps.
 */
export const probeSignals = new EventEmitter();

/** Test-only routes used to probe the platform (guards, filter, context). */
@Controller('test-probe')
export class ProbeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true, context: RequestContext.get() ?? null };
  }

  @Roles(...ALL_ROLES)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user, context: RequestContext.get() ?? null };
  }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Roles(UserRole.FARMER)
  @Get('farmer')
  farmer() {
    return { ok: true };
  }

  // Deliberately without @Public/@Roles: must be rejected (fail closed).
  @Get('no-metadata')
  noMetadata() {
    return { leaked: true };
  }

  // Both decorators: treated as protected, never public.
  @Public()
  @Roles(UserRole.FARMER)
  @Get('both')
  both() {
    return { ok: true };
  }

  @Public()
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: ProbeEchoDto) {
    return { body: { name: body.name }, context: RequestContext.get() ?? null };
  }

  @Public()
  @Post('raw-body')
  @HttpCode(200)
  rawBody(@Req() req: RawBodyRequest<Request>, @Body() body: ProbeEchoDto) {
    return { name: body.name, raw: req.rawBody?.toString('utf8') ?? null };
  }

  @Public()
  @Get('id/:id')
  byId(@IdParam() id: string) {
    return { id };
  }

  @Public()
  @Get('slow')
  async slow(@Query('ms') ms = '300') {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(Number(ms) || 0, 2000)),
    );
    return { done: true };
  }

  @Public()
  @Get('held')
  async held() {
    const released = once(probeSignals, 'release');
    probeSignals.emit('held-entered');
    await released;
    return { done: true };
  }

  @Public()
  @Get('boom')
  boom(): never {
    throw new Error('internal detail /etc/passwd SELECT * FROM users');
  }

  @Public()
  @Get('http-error')
  httpError(): never {
    throw new BadRequestException('Oddiy xato');
  }

  // What FileInterceptor throws for multer's LIMIT_FILE_SIZE.
  @Public()
  @Get('multer-too-large')
  multerTooLarge(): never {
    throw new PayloadTooLargeException('File too large');
  }

  @Public()
  @Get('rate-limited')
  rateLimited(): never {
    throw Errors.tooManyRequests(42);
  }

  @Public()
  @Get('db-error')
  async dbError(@Query('kind') kind: string) {
    const passwordHash =
      'scrypt$16384$8$1$deadbeefdeadbeef$cafebabecafebabe-secret-hash';
    if (kind === 'unique') {
      // Outside the uniquePhone() range (+99899…), so factories never collide.
      const phone = '+998970000001';
      await this.prisma.user.upsert({
        where: { phone },
        update: {},
        create: { phone, fullName: 'Probe', passwordHash },
      });
      await this.prisma.user.create({
        data: { phone, fullName: 'Probe', passwordHash },
      });
    } else if (kind === 'check') {
      await this.prisma.user.create({
        data: { phone: 'not-a-phone', fullName: 'Probe', passwordHash },
      });
    } else if (kind === 'raw-check') {
      await this.prisma
        .$executeRaw`INSERT INTO users (id, phone, full_name, password_hash, updated_at)
        VALUES (${randomUUID()}::uuid, 'bad', 'Probe', ${passwordHash}, now())`;
    } else if (kind === 'fk') {
      await this.prisma.farm.create({
        data: { ownerId: randomUUID(), name: 'Probe' },
      });
    } else if (kind === 'append-only') {
      const row = await this.prisma.auditLog.create({
        data: { action: AuditAction.FILE_UPLOADED, resourceType: 'system' },
      });
      await this.prisma.auditLog.update({
        where: { id: row.id },
        data: { action: 'probe.changed' },
      });
    } else if (kind === 'not-found') {
      await this.prisma.user.findUniqueOrThrow({ where: { id: randomUUID() } });
    }
    return { ok: true };
  }

  @Roles(...ALL_ROLES)
  @Post('idempotent-farm')
  async idempotentFarm(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey() key: string,
    @Body() body: ProbeFarmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.execute(
      { userId: user.id, scope: 'test.probe.farm', key, request: { body } },
      async (tx) => {
        const farm = await tx.farm.create({
          data: { ownerId: user.id, name: body.name },
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (body.fail === 'yes') {
          throw Errors.unprocessable('PROBE_FAILED', 'Sinov xatosi');
        }
        await this.audit.record(
          {
            action: AuditAction.INVENTORY_ITEM_CREATED,
            resourceType: 'system',
            resourceId: farm.id,
            newValue: { name: body.name },
          },
          tx,
        );
        return {
          status: 201,
          body: { id: farm.id, name: farm.name, createdAt: farm.createdAt },
        };
      },
    );
    if (result.replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    res.status(result.status);
    return result.body;
  }
}

/**
 * Class-level @Roles with a handler-level @Public: NOT public. Any @Roles in
 * the handler/class chain makes a route protected (fail closed), so public
 * handlers belong in a controller without class-level @Roles.
 */
@Roles(UserRole.ADMIN)
@Controller('test-probe-mixed')
export class ProbeMixedController {
  @Public()
  @Get('public-inside-roles')
  publicInsideRoles() {
    return { leaked: true };
  }
}
