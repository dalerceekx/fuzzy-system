import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MulterModule,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import type { Env } from '../config/env.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { MALWARE_SCANNER, NoopMalwareScanner } from './malware-scanner.js';

/**
 * Multipart limits. No `storage`/`dest`: multer keeps the file in memory
 * (bounded by fileSize), so nothing touches the disk before validation.
 * Oversized → 413, extra files/fields/parts → 400 (mapped by Nest + the
 * global filter).
 */
export function uploadMulterOptions(maxFileBytes: number): MulterModuleOptions {
  return {
    limits: {
      fileSize: maxFileBytes,
      files: 1,
      fields: 5,
      parts: 7,
      fieldSize: 1024,
      fieldNameSize: 100,
      headerPairs: 50,
    },
    // Decode non-ASCII file names as UTF-8 (display only).
    defParamCharset: 'utf8',
  };
}

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        uploadMulterOptions(
          config.get('UPLOAD_MAX_FILE_BYTES', { infer: true }),
        ),
    }),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    { provide: MALWARE_SCANNER, useClass: NoopMalwareScanner },
  ],
})
export class FilesModule {}
