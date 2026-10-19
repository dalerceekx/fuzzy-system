import type { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth/auth-user.js';
import { ALL_ROLES } from '../common/auth/roles.js';
import { CurrentUser, IdParam, Roles } from '../common/decorators/index.js';
import type { Paginated } from '../common/pagination/index.js';
import { attachmentContentDisposition } from '../storage/storage.types.js';
import { ListFilesQueryDto, UploadFileDto } from './dto/files.dto.js';
import {
  FilesService,
  type FileView,
  type UploadedFileInput,
} from './files.service.js';

export const UPLOAD_FIELD = 'file';

@ApiTags('files')
@ApiBearerAuth()
@Roles(...ALL_ROLES)
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [UPLOAD_FIELD],
      properties: {
        [UPLOAD_FIELD]: { type: 'string', format: 'binary' },
        animalId: { type: 'string', format: 'uuid' },
      },
    },
  })
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileInput | undefined,
    @Body() dto: UploadFileDto,
  ): Promise<FileView> {
    return this.files.upload(user, file, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListFilesQueryDto,
  ): Promise<Paginated<FileView>> {
    return this.files.list(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<FileView> {
    return this.files.get(user, id);
  }

  @Get(':id/content')
  async content(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.files.openContent(user, id);
    // Always a download, never rendered: the browser must not sniff or
    // execute the content even if a crafted file slipped through.
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      attachmentContentDisposition(file.originalName),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream as Readable);
  }

  @Get(':id/signed-url')
  signedUrl(
    @CurrentUser() user: AuthUser,
    @IdParam() id: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    return this.files.signedUrl(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @IdParam() id: string): Promise<void> {
    return this.files.remove(user, id);
  }
}
