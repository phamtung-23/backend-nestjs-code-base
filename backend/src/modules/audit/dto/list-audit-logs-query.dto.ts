import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { toDate, toEndOfDay } from '../../../common/helpers/transform.helpers';
import { ListQueryDto } from '../../../common/query';

// No `include` (entries have no relations) and no `search` (see
// AUDIT_SORTABLE in audit.constants.ts)
export class ListAuditLogsQueryDto extends OmitType(ListQueryDto, [
  'include',
  'search',
] as const) {
  @ApiPropertyOptional({ example: 'user.password_changed', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  // Always a user id
  @ApiPropertyOptional({ example: 'cmufs79e80009o4gpupls7i3y' })
  @IsOptional()
  @IsString()
  @Matches(/^c[a-z0-9]{24}$/, { message: 'actorId must be a user id' })
  actorId?: string;

  @ApiPropertyOptional({ example: 'user', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entity?: string;

  // A user id or a session's familyId (UUID), so only length is checked
  @ApiPropertyOptional({ example: 'cmufs79e80009o4gpupls7i3y', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'A date (UTC) or an ISO-8601 timestamp with Z or an offset',
  })
  @IsOptional()
  @Transform(toDate)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Inclusive; a bare date covers the whole day (UTC)',
  })
  @IsOptional()
  @Transform(toEndOfDay)
  @IsDate()
  createdTo?: Date;
}
