import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { AuthCleanupTask } from './auth-cleanup.task';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

describe('AuthCleanupTask', () => {
  let otpService: jest.Mocked<OtpService>;
  let tokenService: jest.Mocked<TokenService>;
  let loggerLog: jest.SpyInstance;
  let loggerError: jest.SpyInstance;
  let task: AuthCleanupTask;

  beforeEach(() => {
    otpService = {
      cleanup: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<OtpService>;
    tokenService = {
      cleanup: jest.fn().mockResolvedValue(5),
    } as unknown as jest.Mocked<TokenService>;
    loggerLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    task = new AuthCleanupTask(otpService, tokenService);
  });

  afterEach(() => {
    loggerLog.mockRestore();
    loggerError.mockRestore();
  });

  it('is scheduled to run every hour', () => {
    expect(
      Reflect.getMetadata(
        SCHEDULE_CRON_OPTIONS,
        Object.getOwnPropertyDescriptor(AuthCleanupTask.prototype, 'run')
          ?.value as object,
      ),
    ).toMatchObject({ cronTime: CronExpression.EVERY_HOUR });
  });

  it('removes stale codes and refresh tokens and logs how many', async () => {
    await expect(task.run()).resolves.toBeUndefined();

    expect(loggerLog).toHaveBeenCalledWith('Removed 3 stale OTPs');
    expect(loggerLog).toHaveBeenCalledWith('Removed 5 stale refresh tokens');
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('still cleans refresh tokens when the OTP cleanup fails', async () => {
    const error = new Error('database unavailable');
    otpService.cleanup.mockRejectedValue(error);

    await expect(task.run()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Cleanup of stale OTPs failed',
      error.stack,
    );
    expect(tokenService.cleanup).toHaveBeenCalledTimes(1);
    expect(loggerLog).toHaveBeenCalledWith('Removed 5 stale refresh tokens');
  });

  it('logs failures that are not Error instances as strings', async () => {
    tokenService.cleanup.mockRejectedValue('timeout');

    await expect(task.run()).resolves.toBeUndefined();

    expect(loggerError).toHaveBeenCalledWith(
      'Cleanup of stale refresh tokens failed',
      'timeout',
    );
  });
});
