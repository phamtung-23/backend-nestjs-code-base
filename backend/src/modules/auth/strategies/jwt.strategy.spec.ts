import { UnauthorizedException } from '@nestjs/common';
import { AuthConfig } from '../../../config/auth.config';
import { UserRole } from '@prisma/client';
import { PublicUser } from '../../users/interfaces/user.interface';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from './jwt.strategy';

const buildUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: 'user-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  avatar: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  isEmailVerified: true,
  lastLoginAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

describe('JwtStrategy', () => {
  let usersService: jest.Mocked<UsersService>;
  let strategy: JwtStrategy;

  beforeEach(() => {
    usersService = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    strategy = new JwtStrategy(usersService, {
      jwtSecret: 'access-secret',
    } as AuthConfig);
  });

  it('verifies access tokens with the configured JWT secret', () => {
    // passport-jwt keeps the key behind this provider
    const provider = (
      strategy as unknown as {
        _secretOrKeyProvider: (
          request: unknown,
          token: string,
          done: (error: unknown, key: string) => void,
        ) => void;
      }
    )._secretOrKeyProvider;
    const done = jest.fn();

    provider(null, 'raw-token', done);

    expect(done).toHaveBeenCalledWith(null, 'access-secret');
  });

  it('returns the active user for an access token payload', async () => {
    const user = buildUser();
    usersService.findById.mockResolvedValue(user);

    await expect(strategy.validate({ sub: 'user-1' })).resolves.toBe(user);
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
  });

  it('returns null for a disabled user so the request is rejected', async () => {
    usersService.findById.mockResolvedValue(buildUser({ isActive: false }));

    await expect(strategy.validate({ sub: 'user-1' })).resolves.toBeNull();
  });

  it('returns null when the user no longer exists', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'user-1' })).resolves.toBeNull();
  });

  it('rejects a refresh token payload without loading the user', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.findById).not.toHaveBeenCalled();
  });
});
