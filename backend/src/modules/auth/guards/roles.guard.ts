import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ErrorCode } from '../../../common/constants/error-codes';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../interfaces/auth.interface';

// Registered as APP_GUARD after JwtAuthGuard; no-op for routes without @Roles()
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && roles.includes(user.role)) return true;

    throw new ForbiddenException({
      errorCode: ErrorCode.FORBIDDEN,
      message: 'You do not have permission to perform this action',
    });
  }
}
