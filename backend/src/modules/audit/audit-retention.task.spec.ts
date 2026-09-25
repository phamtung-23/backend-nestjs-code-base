import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { AuditRetentionTask } from './audit-retention.task';
import { AuditService } from './audit.service';

describe('AuditRetentionTask', () => {
  let auditService: jest.Mocked<AuditService>;
  let loggerLog: jest.SpyInstance;
  let loggerError: jest.SpyInstance;
  let task: AuditRetentionTask;

  beforeEach(() => {
    auditService = {
      purgeExpired: jest.fn().mockResolvedValue(12),
    } as unknown as jest.Mocked<AuditService>;
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    task = new AuditRetentionTask(auditService);
  });

  afterEach(() => {
    loggerLog.mockRestore();
    loggerError.mockRestore();
  });

  it('is scheduled to run daily at 3 AM', () => {
    expect(
      Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        Object.getOwnPropertyDescriptor(AuditRetentionTask.prototype, 'run')
          ?.value as object,
      ),
    ).toMatchObject({ cronTime: CronExpression.EVERY_DAY_AT_3AM });
  });

  it('purges expired entries and logs how many', async () => {
    await expect(task.run()).resolves.toBeUndefined();

    expect(auditService.purgeExpired).toHaveBeenCalledTimes(1);
    expect(loggerLog).toHaveBeenCalledWith(
      'Removed 12 expired audit log entries',
    );
  });

  it('logs a failure instead of throwing', async () => {
    const error = new Error('database down');
    auditService.purgeExpired.mockRejectedValue(error);

    await expect(task.run()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Audit log retention failed',
      error.stack,
    );
  });

  it('logs non-Error failures as strings', async () => {
    auditService.purgeExpired.mockRejectedValue('timeout');

    await task.run();

    expect(loggerError).toHaveBeenCalledWith(
      'Audit log retention failed',
      'timeout',
    );
  });
});
