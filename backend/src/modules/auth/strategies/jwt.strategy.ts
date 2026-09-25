import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PublicUser } from '../../users/interfaces/user.interface';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/auth.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
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
