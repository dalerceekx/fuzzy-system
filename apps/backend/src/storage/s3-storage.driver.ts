import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetBucketPolicyStatusCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import {
  assertSafeStorageKey,
  attachmentContentDisposition,
  type SignedDownloadOptions,
  type StorageDriver,
} from './storage.types.js';

const MAX_SIGNED_URL_TTL_SECONDS = 3600;

/** Private bucket; objects are encrypted at rest and never public. */
export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly logger = new Logger(S3StorageDriver.name);

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        ServerSideEncryption: 'AES256',
        // Conditional write: fail instead of replacing an existing object.
        IfNoneMatch: '*',
      }),
    );
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    assertSafeStorageKey(key);
    const output = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!output.Body) throw new Error('Empty object body');
    return output.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getSignedDownloadUrl(
    key: string,
    opts: SignedDownloadOptions,
  ): Promise<string> {
    assertSafeStorageKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: attachmentContentDisposition(
        opts.downloadName,
      ),
      ResponseContentType: opts.contentType,
    });
    const expiresIn = Math.min(
      Math.max(1, Math.floor(opts.expiresInSeconds)),
      MAX_SIGNED_URL_TTL_SECONDS,
    );
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * Production: refuse to start if the bucket policy makes it public, and
   * report a missing/partial Block Public Access configuration.
   * `strict` (AWS): any failure of the policy check also refuses to start.
   * Non-strict (S3-compatible endpoint, which may not implement these APIs):
   * an unverifiable bucket is logged at error level instead — the operator
   * must ensure privacy on that service.
   */
  async assertBucketIsPrivate(
    options: { strict: boolean } = { strict: true },
  ): Promise<void> {
    let status;
    try {
      status = await this.client.send(
        new GetBucketPolicyStatusCommand({ Bucket: this.bucket }),
      );
    } catch (err) {
      const name = (err as Error).name;
      if (name !== 'NoSuchBucketPolicy') {
        if (options.strict) throw err;
        this.logger.error(
          { bucket: this.bucket, error: name },
          'could not verify that the S3 bucket is private (custom endpoint); ensure it on the storage service',
        );
        return;
      }
    }
    if (status?.PolicyStatus?.IsPublic) {
      throw new Error(
        `S3 bucket "${this.bucket}" is public; refusing to start`,
      );
    }

    try {
      const block = await this.client.send(
        new GetPublicAccessBlockCommand({ Bucket: this.bucket }),
      );
      const config = block.PublicAccessBlockConfiguration;
      const fullyBlocked =
        config?.BlockPublicAcls === true &&
        config.IgnorePublicAcls === true &&
        config.BlockPublicPolicy === true &&
        config.RestrictPublicBuckets === true;
      if (!fullyBlocked) {
        this.logger.error(
          { bucket: this.bucket },
          'S3 Block Public Access is not fully enabled',
        );
      }
    } catch (err) {
      this.logger.error(
        { bucket: this.bucket, error: (err as Error).name },
        'could not verify S3 Block Public Access configuration',
      );
    }
  }
}
