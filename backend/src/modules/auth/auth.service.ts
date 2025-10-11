import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from './services/email.service';
import * as bcrypt from 'bcryptjs';
import { User } from './interfaces/auth.interface';
import { RegisterDto, ChangePasswordDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

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
    const payload = { email: user.email, sub: user.id, role: user.role };
    
    // Generate access token (short-lived: 15 minutes)
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1d',
    });

    // Generate refresh token (long-lived: 7 days)
    const refreshTokenString = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      {
        expiresIn: '7d',
      },
    );

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenString,
        userId: user.id,
        expiresAt,
        userAgent,
        ipAddress,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshTokenString,
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
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutes

    await this.prisma.otp.create({
      data: {
        code: otpCode,
        expiresAt,
        type: 'VERIFICATION',
        userId: user.id,
      },
    });

    await this.emailService.sendVerificationOtp(user.email, otpCode);

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

    // Find valid OTP
    const otp = await this.prisma.otp.findFirst({
      where: {
        userId: user.id,
        code: otpCode,
        type: 'VERIFICATION',
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!otp) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark OTP as used
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { isUsed: true },
    });

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

    // Generate new OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutes

    await this.prisma.otp.create({
      data: {
        code: otpCode,
        expiresAt,
        type: 'VERIFICATION',
        userId: user.id,
      },
    });

    await this.emailService.sendVerificationOtp(email, otpCode);

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

    // Generate new OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutes

    await this.prisma.otp.create({
      data: {
        code: otpCode,
        expiresAt,
        type: 'PASSWORD_RESET',
        userId: user.id,
      },
    });

    await this.emailService.sendPasswordResetOtp(email, otpCode);

    return {
      message:
        'If an account with that email exists, we have sent a password reset code.',
    };
  }

  async resetPassword(
    email: string,
    otpCode: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Find valid OTP
    const otp = await this.prisma.otp.findFirst({
      where: {
        userId: user.id,
        code: otpCode,
        type: 'PASSWORD_RESET',
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!otp) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    // Mark OTP as used
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { isUsed: true },
    });

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

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutes from now

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

    // Create new OTP
    await this.prisma.otp.create({
      data: {
        code: otpCode,
        expiresAt,
        type: 'LOGIN',
        userId: user.id,
      },
    });

    await this.emailService.sendOtpEmail(email, otpCode);

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

    // Find valid OTP
    const otp = await this.prisma.otp.findFirst({
      where: {
        userId: user.id,
        code: otpCode,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!otp) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Mark OTP as used
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { isUsed: true },
    });

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.login(user, userAgent, ipAddress);
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
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch (error) {
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

    // Generate new access token
    const accessTokenPayload = {
      email: storedToken.user.email,
      sub: storedToken.user.id,
      role: storedToken.user.role,
    };

    const newAccessToken = this.jwtService.sign(accessTokenPayload, {
      expiresIn: '1d',
    });

    // Optionally: Generate new refresh token (rotation)
    const newRefreshToken = this.jwtService.sign(
      { sub: storedToken.user.id, type: 'refresh' },
      {
        expiresIn: '7d',
      },
    );

    // Revoke old refresh token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Store new refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: storedToken.user.id,
        expiresAt,
        userAgent,
        ipAddress,
      },
    });

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
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
