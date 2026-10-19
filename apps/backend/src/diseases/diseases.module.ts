import { Module } from '@nestjs/common';
import { DiseasesController } from './diseases.controller.js';
import { DiseasesService } from './diseases.service.js';

/** "Molim kasal": the read-only disease reference (GET only). */
@Module({
  controllers: [DiseasesController],
  providers: [DiseasesService],
})
export class DiseasesModule {}
