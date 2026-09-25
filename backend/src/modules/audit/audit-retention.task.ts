import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from './audit.service';

// Deletes entries older than AUDIT_RETENTION_DAYS. Housekeeping, not an API:
// the audit trail stays append-only for callers. Runs on every instance — the
// delete is idempotent.
@Injectable()
export class AuditRetentionTask {
  private readonly logger = new Logger(AuditRetentionTask.name);

  constructor(private readonly auditService: AuditService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      const removed = await this.auditService.purgeExpired();
      this.logger.log(`Removed ${removed} expired audit log entries`);
    } catch (error) {
      this.logger.error(
        'Audit log retention failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
