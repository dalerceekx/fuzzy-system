import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../../src/common/decorators/public.decorator.js';
import { SmsService } from '../../../src/sms/sms.service.js';

class QuotaProbeDto {
  @IsString()
  @MaxLength(32)
  phone!: string;
}

/** Test-only route that exercises SmsService.consumeDailyQuota over HTTP. */
@Public()
@Controller('test-sms-quota')
export class SmsQuotaProbeController {
  constructor(private readonly sms: SmsService) {}

  @Post()
  @HttpCode(204)
  async consume(@Body() dto: QuotaProbeDto, @Req() req: Request) {
    await this.sms.consumeDailyQuota(dto.phone, req.ip);
  }
}
