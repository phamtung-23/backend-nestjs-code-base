import { UserRole } from '@prisma/client';
import {
  AuthSessionResponseDto,
  AuthTokensResponseDto,
} from './auth-response.dto';

describe('auth response DTOs', () => {
  const createdAt = new Date('2026-09-01T00:00:00.000Z');

  const user = {
    id: 'user-1',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    avatar: null,
    role: UserRole.CUSTOMER,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdAt,
    updatedAt: createdAt,
  };

  describe('AuthTokensResponseDto.from', () => {
    it('returns only the token pair', () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user,
      };

      expect(AuthTokensResponseDto.from(tokens)).toStrictEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });
  });

  describe('AuthSessionResponseDto.from', () => {
    it('returns the token pair and the public user without the password hash', () => {
      const session = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { ...user, password: 'bcrypt-hash' },
      };

      const dto = AuthSessionResponseDto.from(session);

      expect(dto).toStrictEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-1',
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          avatar: null,
          role: UserRole.CUSTOMER,
          isActive: true,
          isEmailVerified: true,
          lastLoginAt: null,
          createdAt,
        },
      });
      expect(dto.user).not.toHaveProperty('password');
    });
  });
});
