import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import {
  IsSortParam,
  PaginationQueryDto,
  sortParamValues,
} from '../../common/pagination/index.js';

export const FILE_SORT_FIELDS = ['createdAt', 'sizeBytes'] as const;

/** Text fields of the multipart upload (the file itself is `file`). */
export class UploadFileDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  animalId?: string;
}

export class ListFilesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: sortParamValues(FILE_SORT_FIELDS) })
  @IsOptional()
  @IsSortParam(FILE_SORT_FIELDS)
  sort?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  animalId?: string;
}
