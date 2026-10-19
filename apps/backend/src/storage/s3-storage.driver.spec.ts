import {
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3StorageDriver } from './s3-storage.driver.js';
import { buildStorageKey, UnsafeStorageKeyError } from './storage.types.js';

function makeClient() {
  return new S3Client({
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  });
}

function awsError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

describe('S3StorageDriver', () => {
  it('writes private, encrypted objects and never overwrites', async () => {
    const client = makeClient();
    const send = vi.spyOn(client, 'send').mockResolvedValue({} as never);
    const driver = new S3StorageDriver(client, 'bucket');
    const key = buildStorageKey('jpg');

    await driver.put(key, Buffer.from('jpeg'), 'image/jpeg');

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'bucket',
      Key: key,
      ContentType: 'image/jpeg',
      ServerSideEncryption: 'AES256',
      IfNoneMatch: '*',
    });
    expect(command.input).not.toHaveProperty('ACL');
  });

  it('refuses unsafe keys before calling S3', async () => {
    const client = makeClient();
    const send = vi.spyOn(client, 'send');
    const driver = new S3StorageDriver(client, 'bucket');
    await expect(
      driver.put('../x.jpg', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    await expect(driver.getStream('/etc/passwd.jpg')).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    );
    await expect(driver.delete('a/../../b.pdf')).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('presigns downloads as attachments with a bounded lifetime', async () => {
    const driver = new S3StorageDriver(makeClient(), 'bucket');
    const key = buildStorageKey('pdf');
    const url = new URL(
      await driver.getSignedDownloadUrl(key, {
        expiresInSeconds: 300,
        downloadName: 'ma’lumot (1).pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(url.pathname).toBe(`/bucket/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe(
      'application/pdf',
    );
    expect(url.searchParams.get('response-content-disposition')).toBe(
      "attachment; filename*=UTF-8''ma%E2%80%99lumot%20%281%29.pdf",
    );

    const capped = new URL(
      await driver.getSignedDownloadUrl(key, {
        expiresInSeconds: 999_999,
        downloadName: 'a.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(capped.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  describe('assertBucketIsPrivate (production on AWS)', () => {
    it('refuses to start when the bucket policy is public', async () => {
      const client = makeClient();
      vi.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
        if (command instanceof GetBucketPolicyStatusCommand)
          return { PolicyStatus: { IsPublic: true } };
        return {};
      });
      await expect(
        new S3StorageDriver(client, 'bucket').assertBucketIsPrivate(),
      ).rejects.toThrow('public');
    });

    it('accepts a bucket without a policy when Block Public Access is fully on', async () => {
      const client = makeClient();
      vi.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
        if (command instanceof GetBucketPolicyStatusCommand) {
          throw awsError('NoSuchBucketPolicy');
        }
        if (command instanceof GetPublicAccessBlockCommand) {
          return {
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            },
          };
        }
        return {};
      });
      await expect(
        new S3StorageDriver(client, 'bucket').assertBucketIsPrivate(),
      ).resolves.toBeUndefined();
    });

    it('propagates unexpected errors from the policy check (fail closed)', async () => {
      const client = makeClient();
      vi.spyOn(client, 'send').mockRejectedValue(awsError('AccessDenied'));
      await expect(
        new S3StorageDriver(client, 'bucket').assertBucketIsPrivate(),
      ).rejects.toThrow('AccessDenied');
    });

    it('custom endpoint (non-strict): still refuses a public bucket', async () => {
      const client = makeClient();
      vi.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
        if (command instanceof GetBucketPolicyStatusCommand)
          return { PolicyStatus: { IsPublic: true } };
        return {};
      });
      await expect(
        new S3StorageDriver(client, 'bucket').assertBucketIsPrivate({
          strict: false,
        }),
      ).rejects.toThrow('public');
    });

    it('custom endpoint (non-strict): an unsupported API is logged, not fatal', async () => {
      const client = makeClient();
      const send = vi
        .spyOn(client, 'send')
        .mockRejectedValue(awsError('NotImplemented'));
      await expect(
        new S3StorageDriver(client, 'bucket').assertBucketIsPrivate({
          strict: false,
        }),
      ).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
