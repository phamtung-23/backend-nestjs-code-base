import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

jest.mock('bcryptjs');

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

const buildUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  email: 'a@b.com',
  password: 'hashed',
  firstName: 'A',
  lastName: 'B',
  role: 'USER',
  isEmailVerified: false,
  lastLoginAt: null,
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: jest.Mocked<JwtService>;
  let mail: jest.Mocked<MailService>;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      otp: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    jwt = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    mail = {
      sendVerificationOtp: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      sendOtpEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailService>;

    service = new AuthService(prisma as PrismaService, jwt, mail);
  });

  describe('validateUser', () => {
    it('returns user without password when credentials match', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('a@b.com', 'pw');
      expect(result).toMatchObject({ id: 'user-1', email: 'a@b.com' });
      expect(result).not.toHaveProperty('password');
    });

    it('returns null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.validateUser('x', 'y')).toBeNull();
    });

    it('returns null when password mismatch', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      expect(await service.validateUser('a@b.com', 'wrong')).toBeNull();
    });
  });

  describe('login', () => {
    it('signs tokens and stores refresh token', async () => {
      prisma.refreshToken.create.mockResolvedValue({});
      const user = buildUser();
      const out = await service.login(user as any, 'ua', 'ip');
      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          userAgent: 'ua',
          ipAddress: 'ip',
        }),
      });
      expect(out.access_token).toBe('signed-token');
      expect(out.refresh_token).toBe('signed-token');
      expect(out.user).not.toHaveProperty('password');
    });
  });

  describe('register', () => {
    it('creates user, OTP, sends verification email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      prisma.user.create.mockResolvedValue(buildUser());
      prisma.otp.create.mockResolvedValue({});

      const out = await service.register({
        email: 'a@b.com',
        password: 'pw',
      } as any);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ password: 'hashed-pw' }),
      });
      expect(prisma.otp.create).toHaveBeenCalledTimes(1);
      expect(mail.sendVerificationOtp).toHaveBeenCalledTimes(1);
      expect(out.user).not.toHaveProperty('password');
    });

    it('rejects if user already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      await expect(
        service.register({ email: 'a@b.com', password: 'pw' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verifyEmail', () => {
    it('marks email verified on valid OTP', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.findFirst.mockResolvedValue({ id: 'otp-1' });
      prisma.otp.update.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const out = await service.verifyEmail('a@b.com', '123456');
      expect(prisma.otp.update).toHaveBeenCalledWith({
        where: { id: 'otp-1' },
        data: { isUsed: true },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isEmailVerified: true },
      });
      expect(out.message).toMatch(/verified/);
    });

    it('throws NotFoundException if user missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyEmail('x@y.com', '111'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws if email already verified', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ isEmailVerified: true }),
      );
      await expect(
        service.verifyEmail('a@b.com', '111'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws if OTP invalid/expired', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyEmail('a@b.com', 'bad'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resendVerificationEmail', () => {
    it('invalidates old OTPs, creates new one and sends email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.updateMany.mockResolvedValue({ count: 1 });
      prisma.otp.create.mockResolvedValue({});

      const out = await service.resendVerificationEmail('a@b.com');
      expect(prisma.otp.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.otp.create).toHaveBeenCalledTimes(1);
      expect(mail.sendVerificationOtp).toHaveBeenCalledTimes(1);
      expect(out.message).toMatch(/sent/);
    });

    it('throws if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.resendVerificationEmail('x@y.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws if already verified', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ isEmailVerified: true }),
      );
      await expect(
        service.resendVerificationEmail('a@b.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    it('returns generic message when user not found (no leak)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const out = await service.forgotPassword('x@y.com');
      expect(out.message).toMatch(/sent a password reset/);
      expect(mail.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('creates OTP and sends reset email when user exists', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.updateMany.mockResolvedValue({ count: 0 });
      prisma.otp.create.mockResolvedValue({});

      const out = await service.forgotPassword('a@b.com');
      expect(mail.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
      expect(out.message).toMatch(/sent a password reset/);
    });
  });

  describe('resetPassword', () => {
    it('updates password on valid OTP', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.findFirst.mockResolvedValue({ id: 'otp-1' });
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      prisma.otp.update.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const out = await service.resetPassword('a@b.com', '123', 'newpw');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hash' },
      });
      expect(out.message).toMatch(/reset/);
    });

    it('throws if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword('x@y.com', '1', 'p'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws if OTP invalid', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword('a@b.com', 'bad', 'p'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('changes password when current is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(true);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({});

      const out = await service.changePassword('user-1', {
        currentPassword: 'old',
        newPassword: 'new',
      } as any);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hash' },
      });
      expect(out.message).toMatch(/changed/);
    });

    it('throws NotFoundException if user missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword('x', {
          currentPassword: 'a',
          newPassword: 'b',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws if current password incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      (mockedBcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'b',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sendOtp', () => {
    it('invalidates old OTPs, creates new one and sends email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.updateMany.mockResolvedValue({ count: 0 });
      prisma.otp.create.mockResolvedValue({});

      const out = await service.sendOtp('a@b.com');
      expect(mail.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(out.message).toMatch(/sent/);
    });

    it('throws if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendOtp('x@y.com')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('verifyOtp', () => {
    it('logs in user on valid OTP', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.otp.findFirst.mockResolvedValue({ id: 'otp-1' });
      prisma.otp.update.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const out = await service.verifyOtp('a@b.com', '123', 'ua', 'ip');
      expect(out.access_token).toBeDefined();
      expect(out.refresh_token).toBeDefined();
    });

    it('throws if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyOtp('x@y.com', '1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws if OTP invalid', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.otp.findFirst.mockResolvedValue(null);
      await expect(service.verifyOtp('a@b.com', 'bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('cleanupExpiredOtps', () => {
    it('deletes expired/used OTPs and returns count', async () => {
      prisma.otp.deleteMany.mockResolvedValue({ count: 3 });
      const out = await service.cleanupExpiredOtps();
      expect(out.message).toContain('3');
    });
  });

  describe('findById', () => {
    it('returns user without password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      const out = await service.findById('user-1');
      expect(out).not.toHaveProperty('password');
    });

    it('returns null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.findById('missing')).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    const baseStored = () => ({
      id: 'rt-1',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 86400_000),
      user: buildUser(),
    });

    it('rotates tokens when refresh token is valid', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' } as any);
      prisma.refreshToken.findUnique.mockResolvedValue(baseStored());
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const out = await service.refreshAccessToken('rt', 'ua', 'ip');
      expect(out.access_token).toBe('signed-token');
      expect(out.refresh_token).toBe('signed-token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { isRevoked: true },
      });
    });

    it('throws when JWT verification fails', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('bad');
      });
      await expect(service.refreshAccessToken('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when token not stored', async () => {
      jwt.verify.mockReturnValue({} as any);
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshAccessToken('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when token revoked', async () => {
      jwt.verify.mockReturnValue({} as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...baseStored(),
        isRevoked: true,
      });
      await expect(service.refreshAccessToken('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when token expired', async () => {
      jwt.verify.mockReturnValue({} as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...baseStored(),
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.refreshAccessToken('rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('revokes a stored token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt-1' });
      prisma.refreshToken.update.mockResolvedValue({});
      const out = await service.revokeRefreshToken('rt');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { isRevoked: true },
      });
      expect(out.message).toMatch(/revoked/);
    });

    it('throws when token not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(
        service.revokeRefreshToken('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokeAllUserRefreshTokens', () => {
    it('updates all non-revoked tokens for the user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      const out = await service.revokeAllUserRefreshTokens('user-1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRevoked: false },
        data: { isRevoked: true },
      });
      expect(out.message).toMatch(/revoked/);
    });
  });

  describe('cleanupExpiredRefreshTokens', () => {
    it('deletes expired/revoked tokens and reports count', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 });
      const out = await service.cleanupExpiredRefreshTokens();
      expect(out.message).toContain('5');
    });
  });
});
