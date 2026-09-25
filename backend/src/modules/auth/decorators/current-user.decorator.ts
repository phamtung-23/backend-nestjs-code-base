import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PublicUser } from '../../users/interfaces/user.interface';
import { AuthenticatedRequest } from '../interfaces/auth.interface';

// @CurrentUser() user: PublicUser — the active user attached by JwtStrategy
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
