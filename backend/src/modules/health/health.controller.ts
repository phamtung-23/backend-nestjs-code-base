import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

// Served at /health (no version segment, no API prefix) for the Docker
// healthchecks in docker-compose.*.yml
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service and database are up' })
  @ApiErrorResponse(503, 'SERVICE_UNAVAILABLE')
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }

    return { database: 'up' };
  }
}
