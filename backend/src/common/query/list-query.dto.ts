import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../helpers/transform.helpers';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
// Keeps OFFSET bounded (and a safe integer); deeper lists use cursor pagination
export const MAX_PAGE = 10_000;
const MAX_LIST_PARAM_LENGTH = 500;
const MAX_CURSOR_LENGTH = 500;

// Names in fields/include/sort are checked against each resource's whitelist
// by the query helpers, which answer unknown names with INVALID_QUERY_PARAM.

// ?fields= and ?include= — also usable on GET /things/{id}
export class ProjectionQueryDto {
  @ApiPropertyOptional({
    example: 'id,createdAt',
    description: 'Sparse fieldset (comma-separated, whitelisted per resource)',
    maxLength: MAX_LIST_PARAM_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LIST_PARAM_LENGTH)
  fields?: string;

  @ApiPropertyOptional({
    example: 'author',
    description:
      'Relations to embed (comma-separated, whitelisted per resource)',
    maxLength: MAX_LIST_PARAM_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LIST_PARAM_LENGTH)
  include?: string;
}

// What offset and cursor lists share: page size, sort, search, projection
export class ListOptionsQueryDto extends ProjectionQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
    example: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({
    example: '-createdAt',
    description: 'Comma-separated fields; prefix with - for descending',
    maxLength: MAX_LIST_PARAM_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LIST_PARAM_LENGTH)
  sort?: string;

  @ApiPropertyOptional({ example: 'john', minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  search?: string;
}

// Offset pagination: ?page=&limit=, with total counts in meta
export class ListQueryDto extends ListOptionsQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE,
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;
}

// Cursor pagination for large or fast-growing tables: no count, no OFFSET
export class CursorListQueryDto extends ListOptionsQueryDto {
  @ApiPropertyOptional({
    description:
      'meta.nextCursor of the previous page, unchanged; omit for the first page. Repeat the same sort and ' +
      'filters: a cursor from another sort is rejected.',
    example:
      'eyJmIjoiY3JlYXRlZEF0IiwiZCI6ImRlc2MiLCJ0IjoiZGF0ZSIsInYiOiIyMDI2LTAxLTAxVDA4OjAwOjAwLjAwMFoiLCJpZCI6ImNtdWZzNzllODAwMDlvNGdwdXBsczdpM3kifQ',
    maxLength: MAX_CURSOR_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  cursor?: string;
}
