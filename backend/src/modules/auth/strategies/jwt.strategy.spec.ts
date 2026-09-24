import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let authService: jest.Mocked<AuthService>;
  let strategy: JwtStrategy;

  beforeEach(() => {
    authService = {
      findById: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as jest.Mocked<AuthService>;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(authService, config);
  });

  it('returns the user for an access token payload', async () => {
    await expect(strategy.validate({ sub: 'user-1' })).resolves.toEqual({
      id: 'user-1',
    });
    expect(authService.findById).toHaveBeenCalledWith('user-1');
  });

  it('rejects a refresh token payload', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.findById).not.toHaveBeenCalled();
  });
});
