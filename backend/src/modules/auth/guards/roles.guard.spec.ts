import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-codes';
import { PublicUser } from '../../users/interfaces/user.interface';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const handler = () => undefined;
  class TestController {}

  const contextFor = (user?: Pick<PublicUser, 'id' | 'role'>) =>
    ({
      getHandler: () => handler,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const expectForbidden = (context: ExecutionContext) => {
    let error: unknown;
    try {
      guard.canActivate(context);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
  };

  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it.each([
    ['no @Roles() metadata', undefined],
    ['an empty @Roles() list', []],
  ])('allows routes with %s', (_case, roles) => {
    reflector.getAllAndOverride.mockReturnValue(roles);

    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.ADMIN,
      UserRole.CUSTOMER,
    ]);

    expect(
      guard.canActivate(contextFor({ id: 'user-1', role: UserRole.CUSTOMER })),
    ).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      handler,
      TestController,
    ]);
  });

  it('returns 403 FORBIDDEN when the user lacks the role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expectForbidden(contextFor({ id: 'user-1', role: UserRole.CUSTOMER }));
  });

  it('returns 403 FORBIDDEN when no user is attached to the request', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expectForbidden(contextFor());
  });
});
