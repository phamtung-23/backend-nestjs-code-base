import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpType } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcryptjs';
import { JwtPayload, User } from './interfaces/auth.interface';
import { RegisterDto, ChangePasswordDto } from './dto/auth.dto';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes, matches the email templates

@Injectable()
export class AuthService {
  private readonly otpMaxAttempts: number;
  private readonly refreshSecret: string;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    configService: ConfigService,
  ) {
    this.otpMaxAttempts = Number(configService.get('OTP_MAX_ATTEMPTS')) || 5;
    this.refreshSecret = configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user && (await bcrypt.compare(password, user.password))) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: User, userAgent?: string, ipAddress?: string) {
    const tokens = await this.issueTokens(user, userAgent, ipAddress);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  async register(createUserDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
    });

    // Generate and send verification OTP
    const otpCode = await this.createOtp(user.id, 'VERIFICATION');
    await this.mailService.sendVerificationOtp(user.email, otpCode);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...result } = user;
    return {
      message:
        'User registered successfully. Please check your email for the verification code.',
      user: result,
    };
  }

  async verifyEmail(email: string, otpCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    if (!(await this.consumeOtp(user.id, 'VERIFICATION', otpCode))) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark email as verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Invalidate any existing verification OTPs
    await this.prisma.otp.updateMany({
      where: {
        userId: user.id,
        type: 'VERIFICATION',
        isUsed: false,
      },
      data: { isUsed: true },
    });

    const otpCode = await this.createOtp(user.id, 'VERIFICATION');
    await this.mailService.sendVerificationOtp(email, otpCode);

    return { message: 'Verification code sent successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal that the user doesn't exist
      return {
        message:
          'If an account with that email exists, we have sent a password reset code.',
      };
    }

    // Invalidate any existing password reset OTPs
    await this.prisma.otp.updateMany({
      where: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        isUsed: false,
      },
      data: { isUsed: true },
    });

    const otpCode = await this.createOtp(user.id, 'PASSWORD_RESET');
    await this.mailService.sendPasswordResetOtp(email, otpCode);

    return {
      message:
        'If an account with that email exists, we have sent a password reset code.',
    };
  }

  async resetPassword(email: string, otpCode: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!(await this.consumeOtp(user.id, 'PASSWORD_RESET', otpCode))) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return { message: 'Password reset successfully' };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(
      changePasswordDto.newPassword,
      10,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    return { message: 'Password changed successfully' };
  }

  async sendOtp(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Invalidate any existing unused OTPs for this user
    await this.prisma.otp.updateMany({
      where: {
        userId: user.id,
        isUsed: false,
      },
      data: {
        isUsed: true,
      },
    });

    const otpCode = await this.createOtp(user.id, 'LOGIN');
    await this.mailService.sendOtpEmail(email, otpCode);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(
    email: string,
    otpCode: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!(await this.consumeOtp(user.id, 'LOGIN', otpCode))) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.login(user, userAgent, ipAddress);
  }

  private async createOtp(userId: string, type: OtpType): Promise<string> {
    const code = randomInt(100000, 1000000).toString();

    await this.prisma.otp.create({
      data: {
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        type,
        userId,
      },
    });

    return code;
  }

  // Checks the latest active OTP of the given type. Every check counts as an
  // attempt; once otpMaxAttempts is reached the OTP can no longer be used.
  private async consumeOtp(
    userId: string,
    type: OtpType,
    code: string,
  ): Promise<boolean> {
    const otp = await this.prisma.otp.findFirst({
      where: {
        userId,
        type,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      return false;
    }

    // Conditional increment so parallel guesses can't exceed the limit
    const counted = await this.prisma.otp.updateMany({
      where: {
        id: otp.id,
        isUsed: false,
        attempts: { lt: this.otpMaxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });

    if (counted.count === 0 || otp.code !== code) {
      return false;
    }

    // Conditional update so the same OTP can't be consumed twice concurrently
    const consumed = await this.prisma.otp.updateMany({
      where: { id: otp.id, isUsed: false },
      data: { isUsed: true },
    });

    return consumed.count === 1;
  }

  // Clean up expired OTPs (can be called periodically)
  async cleanupExpiredOtps() {
    const deleted = await this.prisma.otp.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: new Date(),
            },
          },
          {
            isUsed: true,
            createdAt: {
              lt: new Date(Date.now() - 86400000), // older than 24 hours
            },
          },
        ],
      },
    });

    return { message: `Cleaned up ${deleted.count} expired OTPs` };
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...result } = user;
    return result;
  }

  async refreshAccessToken(
    refreshToken: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    // Verify refresh token JWT signature
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Check if refresh token exists in database and is valid
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    if (storedToken.isRevoked) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Rotate: revoke the old refresh token and issue a new pair
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    return this.issueTokens(storedToken.user, userAgent, ipAddress);
  }

  private async issueTokens(
    user: Pick<User, 'id' | 'email' | 'role'>,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const accessToken = this.jwtService.sign(
      { email: user.email, sub: user.id, role: user.role },
      { expiresIn: '1d' },
    );

    // Signed with a separate secret so it can never pass as an access token.
    // jti keeps tokens unique when two are issued within the same second
    // (the token column is unique).
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh', jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: '7d' },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
        userAgent,
        ipAddress,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async revokeRefreshToken(refreshToken: string) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken) {
      throw new NotFoundException('Refresh token not found');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    return { message: 'Refresh token revoked successfully' };
  }

  async revokeAllUserRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: { isRevoked: true },
    });

    return { message: 'All refresh tokens revoked successfully' };
  }

  async cleanupExpiredRefreshTokens() {
    const deleted = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: new Date(),
            },
          },
          {
            isRevoked: true,
            createdAt: {
              lt: new Date(Date.now() - 2592000000), // older than 30 days
            },
          },
        ],
      },
    });

    return { message: `Cleaned up ${deleted.count} expired refresh tokens` };
  }
}
