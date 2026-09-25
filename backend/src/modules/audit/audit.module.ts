import { Global, Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditRetentionTask } from './audit-retention.task';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

// Global: any module records audit entries through AuditService
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, AuditRepository, AuditRetentionTask],
  exports: [AuditService],
})
export class AuditModule {}
