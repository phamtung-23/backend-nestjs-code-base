import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpType, Prisma } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import {
  OTP_ISSUE_WINDOW_MS,
  OTP_LENGTH,
  OTP_MAX_ISSUED_PER_WINDOW,
  OTP_RESEND_COOLDOWN_MS,
  USED_OTP_RETENTION_MS,
} from './auth.constants';
import { OtpRepository } from './otp.repository';

// Constant-time comparison, so response timing reveals nothing about the code
function codesMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class OtpService {
  private readonly maxAttempts: number;
  readonly expiryMinutes: number;

  constructor(
    private readonly otpRepository: OtpRepository,
    configService: ConfigService,
  ) {
    // Defaults live in env validation
    this.maxAttempts = configService.getOrThrow<number>('OTP_MAX_ATTEMPTS');
    this.expiryMinutes = configService.getOrThrow<number>('OTP_EXPIRY_MINUTES');
  }

  // Issues a new numeric code and invalidates older codes of the same type.
  // Returns null while the account is in its cooldown or over the hourly cap.
  // Run it inside a transaction that holds the user lock, so concurrent
  // requests can't slip past the limits or leave two live codes.
  async issue(
    userId: string,
    type: OtpType,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const issued = await this.otpRepository.findIssuedSince(
      userId,
      type,
      new Date(Date.now() - OTP_ISSUE_WINDOW_MS),
      tx,
    );
    const latest = issued[0];
    if (
      issued.length >= OTP_MAX_ISSUED_PER_WINDOW ||
      (latest && Date.now() - latest.getTime() < OTP_RESEND_COOLDOWN_MS)
    ) {
      return null;
    }

    const code = randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();

    await this.otpRepository.invalidateActive(userId, type, tx);
    await this.otpRepository.create(
      {
        userId,
        type,
        code,
        expiresAt: new Date(Date.now() + this.expiryMinutes * 60 * 1000),
      },
      tx,
    );
    return code;
  }

  // Checks the latest active code of the type. Every check counts as an
  // attempt; after maxAttempts the code is dead even if the next guess is right.
  async consume(
    userId: string,
    type: OtpType,
    code: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const otp = await this.otpRepository.findLatestActive(userId, type, tx);
    if (!otp) {
      return false;
    }

    const counted = await this.otpRepository.registerAttempt(
      otp.id,
      this.maxAttempts,
      tx,
    );
    if (!counted || !codesMatch(otp.code, code)) {
      return false;
    }

    return this.otpRepository.markUsed(otp.id, tx);
  }

  // Deletes expired codes and used ones older than a day
  cleanup(): Promise<number> {
    return this.otpRepository.deleteStale(
      new Date(Date.now() - USED_OTP_RETENTION_MS),
    );
  }
}
