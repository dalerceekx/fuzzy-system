import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppException, Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { truncate } from '../common/strings.js';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { FileScanStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sha256Hex } from '../security/crypto.js';
import {
  buildStorageKey,
  STORAGE_DRIVER,
  type StorageDriver,
} from '../storage/storage.types.js';
import { cleanDisplayName, sanitizeDisplayName } from './display-name.js';
import type { ListFilesQueryDto, UploadFileDto } from './dto/files.dto.js';
import {
  hasActiveContent,
  inspectUpload,
  normalizeMime,
  type FileRejectionReason,
} from './file-inspection.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
  type MalwareScanVerdict,
} from './malware-scanner.js';
import { MalformedImageError, stripMetadata } from './metadata-strip.js';

/** The parts of a multer (memory storage) file this module uses. */
export interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Response shape: the storage key and owner never leave the server. */
export const FILE_PUBLIC_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  scanStatus: true,
  metadataStripped: true,
  animalId: true,
  createdAt: true,
} as const satisfies Prisma.StoredFileSelect;

export type FileView = Prisma.StoredFileGetPayload<{
  select: typeof FILE_PUBLIC_SELECT;
}>;

const SERVABLE_SCAN_STATUSES: readonly FileScanStatus[] = [
  FileScanStatus.CLEAN,
  FileScanStatus.SKIPPED,
];

const SCAN_STATUS: Record<
  Exclude<MalwareScanVerdict, 'infected'>,
  FileScanStatus
> = {
  clean: FileScanStatus.CLEAN,
  unscanned: FileScanStatus.SKIPPED,
};

const SORT_MAPPING = {
  createdAt: (dir: 'asc' | 'desc') => ({ createdAt: dir }),
  sizeBytes: (dir: 'asc' | 'desc') => ({ sizeBytes: dir }),
};

const unsupportedFileType = () =>
  new AppException(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'UNSUPPORTED_FILE_TYPE',
    'Faqat JPG, PNG, WebP yoki PDF fayl yuklash mumkin',
  );

const storageUnavailable = () =>
  new AppException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'STORAGE_UNAVAILABLE',
    'Fayllar ombori vaqtincha ishlamayapti. Keyinroq qayta urinib ko‘ring',
  );

function errorCode(err: unknown): string {
  const { name, code } = err as { name?: unknown; code?: unknown };
  return String(code ?? name ?? 'unknown');
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  async upload(
    user: AuthUser,
    file: UploadedFileInput | undefined,
    dto: UploadFileDto,
  ): Promise<FileView> {
    if (!file) throw Errors.badRequest('FILE_REQUIRED', 'Fayl yuborilmadi');
    if (file.buffer.length === 0) {
      throw Errors.badRequest('EMPTY_FILE', 'Fayl bo‘sh');
    }

    const inspection = await inspectUpload({
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMime: file.mimetype,
    });
    if (!inspection.ok) {
      await this.recordRejection(
        file,
        inspection.reason,
        inspection.detectedMime,
      );
      throw unsupportedFileType();
    }
    const { type } = inspection;

    let body = file.buffer;
    let metadataStripped = false;
    if (this.config.get('UPLOAD_STRIP_METADATA', { infer: true })) {
      try {
        ({ buffer: body, stripped: metadataStripped } = stripMetadata(
          file.buffer,
          type.ext,
        ));
      } catch (err) {
        if (!(err instanceof MalformedImageError)) throw err;
        await this.recordRejection(file, 'malformed_image', type.mime);
        throw unsupportedFileType();
      }
    }
    // Stripping shortens the file and can pull bytes that sat beyond the
    // sniffed head of the upload into the head of the stored object, so the
    // body that is actually stored is sniffed again.
    if (body !== file.buffer && hasActiveContent(body)) {
      await this.recordRejection(file, 'active_content', type.mime);
      throw unsupportedFileType();
    }

    const sha256 = sha256Hex(body);
    const verdict = await this.scanner.scan({
      buffer: body,
      mimeType: type.mime,
      sha256,
    });
    if (verdict === 'infected') {
      await this.recordRejection(file, 'infected', type.mime);
      throw Errors.unprocessable(
        'FILE_INFECTED',
        'Faylda zararli dastur aniqlandi',
      );
    }

    // The key is generated server-side; the client file name is display
    // text only and never reaches the storage layer.
    const storageKey = buildStorageKey(type.ext);
    const created = await this.prisma.$transaction(async (tx) => {
      // Serializes uploads of one owner so concurrent requests cannot
      // overshoot the quota.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`files:${user.id}`}))`;
      const usage = await tx.storedFile.aggregate({
        where: { ownerId: user.id, deletedAt: null },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      });
      const maxFiles = this.config.get('UPLOAD_MAX_FILES_PER_USER', {
        infer: true,
      });
      const quotaBytes = this.config.get('UPLOAD_USER_QUOTA_BYTES', {
        infer: true,
      });
      if (
        usage._count._all + 1 > maxFiles ||
        (usage._sum.sizeBytes ?? 0) + body.length > quotaBytes
      ) {
        throw Errors.conflict(
          'QUOTA_EXCEEDED',
          'Fayllar uchun ajratilgan joy tugagan',
        );
      }

      if (dto.animalId) {
        const animal = await tx.animal.findFirst({
          where: {
            id: dto.animalId,
            archivedAt: null,
            farm: { ownerId: user.id },
          },
          select: { id: true },
        });
        if (!animal) throw Errors.notFound();
      }

      const row = await tx.storedFile.create({
        data: {
          ownerId: user.id,
          storageKey,
          originalName: sanitizeDisplayName(file.originalname, type.ext),
          mimeType: type.mime,
          sizeBytes: body.length,
          sha256,
          scanStatus: SCAN_STATUS[verdict],
          metadataStripped,
          animalId: dto.animalId ?? null,
        },
        select: FILE_PUBLIC_SELECT,
      });
      await this.audit.record(
        {
          action: AuditAction.FILE_UPLOADED,
          resourceType: 'file',
          resourceId: row.id,
          newValue: {
            originalName: row.originalName,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            sha256: row.sha256,
            scanStatus: row.scanStatus,
            metadataStripped: row.metadataStripped,
            animalId: row.animalId,
          },
        },
        tx,
      );
      return row;
    });

    // Stored after commit so the quota lock is not held during the upload;
    // a failed write leaves only a soft-deleted row behind.
    try {
      await this.storage.put(storageKey, body, type.mime);
    } catch (err) {
      this.logger.error(
        { fileId: created.id, error: errorCode(err) },
        'storing an uploaded file failed',
      );
      await this.markStorageFailure(created.id);
      throw storageUnavailable();
    }
    return created;
  }

  async list(
    user: AuthUser,
    query: ListFilesQueryDto,
  ): Promise<Paginated<FileView>> {
    const where: Prisma.StoredFileWhereInput = {
      ownerId: user.id,
      deletedAt: null,
      ...(query.animalId ? { animalId: query.animalId } : {}),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, SORT_MAPPING, { createdAt: 'desc' }),
      { id: 'asc' },
    ] as Prisma.StoredFileOrderByWithRelationInput[];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.storedFile.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
        select: FILE_PUBLIC_SELECT,
      }),
      this.prisma.storedFile.count({ where }),
    ]);
    return paginated(items, total, query);
  }

  async get(user: AuthUser, id: string): Promise<FileView> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, ownerId: user.id, deletedAt: null },
      select: FILE_PUBLIC_SELECT,
    });
    if (!file) throw Errors.notFound();
    return file;
  }

  /** Ownership-checked content stream of a servable file. */
  async openContent(
    user: AuthUser,
    id: string,
  ): Promise<{
    file: { originalName: string; mimeType: string; sizeBytes: number };
    stream: NodeJS.ReadableStream;
  }> {
    const file = await this.findServable(user, id);
    try {
      return { file, stream: await this.storage.getStream(file.storageKey) };
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ENOENT' || code === 'NoSuchKey') throw Errors.notFound();
      this.logger.error({ fileId: id, error: code }, 'reading a file failed');
      throw storageUnavailable();
    }
  }

  async signedUrl(
    user: AuthUser,
    id: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const file = await this.findServable(user, id);
    const ttl = this.config.get('S3_SIGNED_URL_TTL_SECONDS', { infer: true });
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const url = await this.storage.getSignedDownloadUrl(file.storageKey, {
      expiresInSeconds: ttl,
      downloadName: file.originalName,
      contentType: file.mimeType,
    });
    // The local driver cannot sign: clients use the content endpoint.
    if (!url) throw Errors.notFound();
    return { url, expiresAt };
  }

  /** Soft delete (row kept for the audit trail) + object removal. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const deletedAt = new Date();
    const file = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.storedFile.findFirst({
        where: { id, ownerId: user.id, deletedAt: null },
        select: {
          storageKey: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
        },
      });
      if (!existing) throw Errors.notFound();
      // Conditional update: a concurrent delete affects 0 rows → 404.
      const { count } = await tx.storedFile.updateMany({
        where: { id, ownerId: user.id, deletedAt: null },
        data: { deletedAt },
      });
      if (count !== 1) throw Errors.notFound();
      await this.audit.record(
        {
          action: AuditAction.FILE_DELETED,
          resourceType: 'file',
          resourceId: id,
          oldValue: {
            originalName: existing.originalName,
            mimeType: existing.mimeType,
            sizeBytes: existing.sizeBytes,
          },
          newValue: { deletedAt },
        },
        tx,
      );
      return existing;
    });

    try {
      await this.storage.delete(file.storageKey);
    } catch (err) {
      // The row is already soft-deleted and never served again; an
      // orphaned object can be cleaned up later from the deleted rows.
      this.logger.warn(
        { fileId: id, error: errorCode(err) },
        'removing a deleted file from storage failed',
      );
    }
  }

  private async findServable(user: AuthUser, id: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, ownerId: user.id, deletedAt: null },
      select: {
        storageKey: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        scanStatus: true,
      },
    });
    if (!file) throw Errors.notFound();
    if (!SERVABLE_SCAN_STATUSES.includes(file.scanStatus)) {
      throw Errors.conflict(
        'FILE_NOT_AVAILABLE',
        'Fayl tekshiruvdan o‘tmagan, uni yuklab olib bo‘lmaydi',
      );
    }
    return file;
  }

  private async recordRejection(
    file: UploadedFileInput,
    reason: FileRejectionReason | 'malformed_image' | 'infected',
    detectedMime: string | null,
  ): Promise<void> {
    await this.audit.record({
      action: AuditAction.FILE_REJECTED,
      resourceType: 'file',
      resourceId: null,
      newValue: {
        reason,
        originalName: cleanDisplayName(file.originalname) || null,
        declaredMime: truncate(normalizeMime(file.mimetype), 100) || null,
        detectedMime,
        sizeBytes: file.buffer.length,
      },
    });
  }

  private async markStorageFailure(id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storedFile.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await this.audit.record(
          {
            action: AuditAction.FILE_REJECTED,
            resourceType: 'file',
            resourceId: id,
            newValue: { reason: 'storage_unavailable' },
          },
          tx,
        );
      });
    } catch (err) {
      this.logger.error(
        { fileId: id, error: errorCode(err) },
        'could not mark a file whose storage write failed',
      );
    }
  }
}
