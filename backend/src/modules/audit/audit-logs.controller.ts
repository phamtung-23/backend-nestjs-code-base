import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator';
import { ResponseHelper } from '../../common/helpers/response.helper';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@ApiTags('Audit logs')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.ADMIN)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @ApiOperation({
    summary: 'List audit log entries (admin)',
    description:
      'Filter by action, actor, entity or date range; newest first by default (sort=createdAt for oldest first). ' +
      'Cursor pagination: pass meta.nextCursor as ?cursor= for the next page.',
  })
  @ApiEnvelopeResponse(AuditLogResponseDto, { paginated: 'cursor' })
  @ApiErrorResponse(400, 'VALIDATION_FAILED', 'INVALID_QUERY_PARAM')
  @ApiErrorResponse(401, 'UNAUTHENTICATED')
  @ApiErrorResponse(403, 'FORBIDDEN')
  @Get()
  async list(@Query() query: ListAuditLogsQueryDto) {
    const { items, meta } = await this.auditService.list(query);
    return ResponseHelper.cursorPaginated(
      items,
      meta,
      'Audit log entries retrieved',
    );
  }
}
