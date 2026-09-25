import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

// Every login and refresh adds rows; this keeps otps and refresh_tokens from
// growing forever. Runs on every instance — the deletes are idempotent.
@Injectable()
export class AuthCleanupTask {
  private readonly logger = new Logger(AuthCleanupTask.name);

  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    // Separate steps, so one failing doesn't skip the other
    await this.step('OTPs', () => this.otpService.cleanup());
    await this.step('refresh tokens', () => this.tokenService.cleanup());
  }

  private async step(
    label: string,
    cleanup: () => Promise<number>,
  ): Promise<void> {
    try {
      const removed = await cleanup();
      this.logger.log(`Removed ${removed} stale ${label}`);
    } catch (error) {
      this.logger.error(
        `Cleanup of stale ${label} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
