import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const handler = () => undefined;
  class TestController {}
  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;

  let reflector: { getAllAndOverride: jest.Mock };
  let passportCanActivate: jest.SpyInstance;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    // AuthGuard('jwt') is memoized, so this is the class JwtAuthGuard extends
    passportCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);

    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  afterEach(() => passportCanActivate.mockRestore());

  it('lets @Public() routes through without running passport', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      handler,
      TestController,
    ]);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('delegates routes without @Public() to the passport jwt guard', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(passportCanActivate).toHaveBeenCalledWith(context);
  });

  it('propagates the 401 from passport for a missing or invalid token', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    passportCanActivate.mockRejectedValue(new UnauthorizedException());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
