import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthConfig, authConfig } from '../../../config/auth.config';
import { PublicUser } from '../../users/interfaces/user.interface';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/auth.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    @Inject(authConfig.KEY) config: AuthConfig,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<PublicUser | null> {
    // Refresh tokens must never authenticate API calls, even if both secrets
    // are configured with the same value
    if (payload.type === 'refresh') {
      throw new UnauthorizedException();
    }

    // Deleted or disabled accounts lose access now, not when the token expires
    const user = await this.usersService.findById(payload.sub);
    return user?.isActive ? user : null;
  }
}
