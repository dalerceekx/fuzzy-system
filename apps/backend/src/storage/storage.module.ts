import { S3Client } from '@aws-sdk/client-s3';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { LocalStorageDriver } from './local-storage.driver.js';
import { S3StorageDriver } from './s3-storage.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage.types.js';

function createS3Client(config: ConfigService<Env, true>): S3Client {
  const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
  return new S3Client({
    region: config.get('S3_REGION', { infer: true }),
    endpoint: config.get('S3_ENDPOINT', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    // Without static keys the SDK falls back to the IAM role chain.
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<Env, true>,
      ): Promise<StorageDriver> => {
        if (config.get('STORAGE_DRIVER', { infer: true }) === 'local') {
          // Env validation guarantees an absolute path (and forbids `local`
          // in production).
          return new LocalStorageDriver(
            config.get('UPLOAD_LOCAL_DIR', { infer: true }) ?? '',
          );
        }
        const driver = new S3StorageDriver(
          createS3Client(config),
          config.get('S3_BUCKET', { infer: true }),
        );
        const onAws = !config.get('S3_ENDPOINT', { infer: true });
        if (config.get('NODE_ENV', { infer: true }) === 'production') {
          // Always checked in production; only AWS is fail-closed on errors
          // (S3-compatible services may lack the policy-status API).
          await driver.assertBucketIsPrivate({ strict: onAws });
        } else if (onAws) {
          new Logger('StorageModule').warn(
            'S3 bucket privacy check skipped outside production',
          );
        }
        return driver;
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
